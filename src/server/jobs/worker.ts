/**
 * In-process render worker — single drain loop per process.
 *
 * Risk A3 mitigation: idempotent start guarded by globalThis flag +
 * NEXT_RUNTIME check so HMR hot-reloads don't double-spawn the worker.
 *
 * The queue is a simple in-memory array. When a render job is enqueued,
 * the drain loop picks it up, runs ffmpeg via renderer.ts, and updates the
 * job status in the store.
 */

import path from "node:path";
import { getJob, updateJob, crashRecoverySweep, getAllJobs } from "./store";
import { updatePlanBundle } from "./plan-bundle";
import { renderVideo } from "@/server/ffmpeg/renderer";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import type { ResolvedPick } from "@/shared/types";
import { getRuntimePaths } from "@/server/runtime/paths";

const queue: string[] = [];
let draining = false;

declare global {
  // eslint-disable-next-line no-var
  var __weatherWorkerStarted: boolean | undefined;
}

export function enqueueJob(jobId: string): void {
  if (!queue.includes(jobId)) queue.push(jobId);
  scheduleDrain();
}

function scheduleDrain(): void {
  if (draining) return;
  setImmediate(drain);
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const jobId = queue.shift()!;
    const job = getJob(jobId);
    if (!job || job.status !== "queued") continue;
    await runJob(jobId, job.audio_filename ?? "");
  }
  draining = false;
}

async function runJob(jobId: string, audioFilename: string): Promise<void> {
  const { uploadsDir, outputsDir } = getRuntimePaths();
  updateJob(jobId, { status: "processing" });
  const audioPath = path.join(uploadsDir, audioFilename);
  const outputPath = path.join(outputsDir, `forecast_${jobId}.mp4`);

  try {
    // Re-read plan bundle to get the finalized timeline
    const { readPlanBundle } = await import("./plan-bundle");
    const bundle = readPlanBundle(jobId);
    const timeline = (bundle.timeline ?? []) as ResolvedPick[];

    if (!timeline.length) {
      updateJob(jobId, { status: "failed", error: "No timeline in plan bundle" });
      return;
    }

    // Build video map from current catalog
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const videoMap = buildVideoMap(videos);

    const success = await renderVideo(timeline, videoMap, audioPath, outputPath);
    if (success) {
      updateJob(jobId, {
        status: "completed",
        output_url: path.basename(outputPath),
      });
      updatePlanBundle(jobId, { output_url: path.basename(outputPath) });
    } else {
      updateJob(jobId, { status: "failed", error: "Renderer returned failure" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${jobId} failed:`, msg);
    updateJob(jobId, { status: "failed", error: msg });
  }
}

export function startWorker(): void {
  // Risk A3: only start once per process, only in Node.js runtime
  if (typeof process === "undefined") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__weatherWorkerStarted) return;
  globalThis.__weatherWorkerStarted = true;

  crashRecoverySweep();

  // Re-enqueue any jobs that were queued before the process died
  for (const job of getAllJobs()) {
    if (job.status === "queued") enqueueJob(job.job_id);
  }

  console.log("[worker] started");
}
