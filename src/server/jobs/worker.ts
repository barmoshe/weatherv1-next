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
import { markJobCompleted, markRenderFailed } from "./failure";
import { readPlanBundle, updatePlanBundle } from "./plan-bundle";
import { renderVideo } from "@/server/ffmpeg/renderer";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildVideoMap } from "@/server/catalog/parser";
import type { ResolvedPick } from "@/shared/types";
import { getRuntimePaths } from "@/server/runtime/paths";
import { hydrateVoiceoverFromR2 } from "@/server/sync/r2/hydrate-voiceover";
import { prepareRenderMedia } from "./render-media";
import { sortTimelineForRender } from "@/server/pipeline/validator";

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

/**
 * 1-based position of a job in the render queue, or null if not queued.
 * Process-local and approximate (resets on restart, not mirrored) — for UX
 * hints only. The job currently rendering is not in the queue array.
 */
export function queuePosition(jobId: string): number | null {
  const idx = queue.indexOf(jobId);
  return idx === -1 ? null : idx + 1;
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
  const audioPath = path.join(uploadsDir, path.basename(audioFilename));
  const outputPath = path.join(outputsDir, `forecast_${jobId}.mp4`);

  try {
    await hydrateVoiceoverFromR2(jobId, audioFilename, audioPath);

    // Re-read plan bundle to get the finalized timeline
    const bundle = readPlanBundle(jobId);
    const timeline = (bundle.timeline ?? []) as ResolvedPick[];
    sortTimelineForRender(timeline);

    if (!timeline.length) {
      markRenderFailed(jobId, "no_timeline", "No timeline in plan bundle");
      return;
    }

    // Build video map from current catalog
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const videoMap = buildVideoMap(videos);

    const prepared = await prepareRenderMedia(timeline, videoMap, jobId);
    let success = false;
    try {
      // Passing { jobId } registers the ffmpeg child so Cancel can kill it,
      // and onProgress drives the live progress bar. Throttled to ~1/s or a
      // ≥5% jump, and written with mirror:false since progress is ephemeral —
      // the next durable transition mirrors the real state.
      const startTs = Date.now();
      let lastWrite = 0;
      let lastPct = 0;
      const onProgress = (pct: number) => {
        const now = Date.now();
        if (now - lastWrite < 1000 && pct - lastPct < 0.05) return;
        lastWrite = now;
        lastPct = pct;
        const elapsed = (now - startTs) / 1000;
        const eta = pct > 0 ? Math.round((elapsed * (1 - pct)) / pct) : null;
        updateJob(jobId, { progress: pct, eta_sec: eta }, { mirror: false });
      };
      success = await renderVideo(prepared.timeline, prepared.videoMap, audioPath, outputPath, {
        jobId,
        onProgress,
      });
    } finally {
      await prepared.cleanup();
    }

    if (success) {
      markJobCompleted(jobId, path.basename(outputPath));
      await updatePlanBundle(jobId, { output_url: path.basename(outputPath) });
    } else {
      markRenderFailed(jobId, "render_ffmpeg_failed", "Renderer returned failure", "ffmpeg");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[worker] job ${jobId} failed:`, msg);
    markRenderFailed(jobId, "worker_unknown", msg);
  }
}

export function startWorker(): void {
  // Risk A3: only start once per process, only in Node.js runtime
  if (typeof process === "undefined") return;
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalThis.__weatherWorkerStarted) return;
  globalThis.__weatherWorkerStarted = true;

  crashRecoverySweep();

  // Re-enqueue any jobs that were queued before the process died, and resume
  // jobs that were interrupted mid-render (bounded to avoid crash loops).
  for (const job of getAllJobs()) {
    if (job.status === "queued") {
      enqueueJob(job.job_id);
    } else if (job.status === "interrupted") {
      resumeInterruptedJob(job.job_id);
    }
  }

  console.log("[worker] started");
}

/** Max times a job is auto-requeued after an interrupted render before giving up. */
const MAX_INTERRUPT_RETRIES = 3;

/**
 * Promote an interrupted job back to the render queue if it still has the work
 * to do (timeline + audio). Bounded by `interrupt_count` so a render that keeps
 * crashing the process doesn't loop forever on every boot.
 */
function resumeInterruptedJob(jobId: string): void {
  const job = getJob(jobId);
  if (!job || job.status !== "interrupted") return;

  const count = job.interrupt_count ?? 0;
  if (count >= MAX_INTERRUPT_RETRIES) {
    markRenderFailed(
      jobId,
      "interrupted_retry_exhausted",
      `Render interrupted ${count} times; giving up.`,
    );
    return;
  }

  const hasAudio = Boolean(job.audio_filename);
  const bundle = readPlanBundle(jobId);
  const timeline = bundle.timeline as unknown[] | undefined;
  if (!hasAudio || !timeline?.length) {
    markRenderFailed(
      jobId,
      "interrupted_unresumable",
      "Render was interrupted and cannot resume (missing audio or timeline).",
    );
    return;
  }

  updateJob(jobId, { status: "queued", interrupt_count: count + 1 });
  enqueueJob(jobId);
}
