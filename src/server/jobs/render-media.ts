import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { downloadR2File } from "@/server/sync/r2/client";
import { getRuntimePaths } from "@/server/runtime/paths";
import { spawnFFmpeg } from "@/server/ffmpeg/spawn";
import { getFFmpegPath } from "@/server/ffmpeg/binaries";
import type { ParsedVideo, ResolvedPick } from "@/shared/types";
import { narrativeDecodeFromPick } from "@/server/ffmpeg/timeline-clip-timing";

export interface RenderReadyMedia {
  filePath: string;
  duration: number;
  segmentId: string;
  videoId: string;
}

export interface PreparedRenderMedia {
  timeline: ResolvedPick[];
  videoMap: Record<string, ParsedVideo>;
  media: RenderReadyMedia[];
  tempDir: string;
  cleanup: () => Promise<void>;
}

interface PrepareRenderMediaOptions {
  tempRoot?: string;
  downloadObject?: typeof downloadR2File;
  cutSegment?: (args: {
    sourcePath: string;
    outputPath: string;
    start: number;
    decodeDur: number;
    padDur: number;
    jobId?: string;
  }) => Promise<void>;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function pickKey(pick: ResolvedPick): string {
  return createHash("sha1")
    .update([pick.video_id, pick.segment_id, pick.video_start ?? 0, pick.video_end ?? "", pick.audio_end - pick.audio_start].join("|"))
    .digest("hex")
    .slice(0, 12);
}

async function defaultCutSegment(args: {
  sourcePath: string;
  outputPath: string;
  start: number;
  decodeDur: number;
  padDur: number;
  jobId?: string;
}): Promise<void> {
  await fs.promises.mkdir(path.dirname(args.outputPath), { recursive: true });
  const MIN_PAD = 1e-6;
  const tpad =
    args.padDur > MIN_PAD ? `,tpad=stop_mode=clone:stop_duration=${args.padDur}` : "";
  const vf =
    `trim=start=0:duration=${args.decodeDur},setpts=PTS-STARTPTS,format=yuv420p${tpad}`;
  const result = await spawnFFmpeg(getFFmpegPath(), [
    "-ss", String(args.start),
    "-t", String(args.decodeDur),
    "-i", args.sourcePath,
    "-vf", vf,
    "-map", "0:v:0",
    "-an",
    "-c:v", "libx264",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    "-y", args.outputPath,
  ], { jobId: args.jobId });

  if (result.code !== 0) {
    throw new Error(`Failed to prepare render segment: ${result.stderrTail}`);
  }
}

// Independent R2 fetches; bounded so we don't hammer the gateway.
const DOWNLOAD_CONCURRENCY = 4;
// ffmpeg + libx264 is CPU-heavy. 2 in parallel halves wall time on most
// machines without thrashing; higher only helps on >=8-core hosts.
const CUT_CONCURRENCY = 2;

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const workerCount = Math.min(limit, items.length);
  const workers = Array.from({ length: workerCount }, async () => {
    while (true) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

interface CutPlan {
  key: string;
  pick: ResolvedPick;
  sourceVideo: ParsedVideo;
  audioDur: number;
  seekStart: number;
  decodeDur: number;
  padDur: number;
  mediaId: string;
  outputPath: string;
}

export async function prepareRenderMedia(
  timeline: ResolvedPick[],
  sourceVideoMap: Record<string, ParsedVideo>,
  jobId: string,
  options: PrepareRenderMediaOptions = {},
): Promise<PreparedRenderMedia> {
  const tempRoot = options.tempRoot ?? getRuntimePaths().renderTmpDir;
  const tempDir = path.join(tempRoot, safeId(jobId));
  const sourcesDir = path.join(tempDir, "sources");
  const segmentsDir = path.join(tempDir, "segments");
  const downloadObject = options.downloadObject ?? downloadR2File;
  const cutSegment = options.cutSegment ?? defaultCutSegment;

  await fs.promises.rm(tempDir, { recursive: true, force: true });
  await fs.promises.mkdir(sourcesDir, { recursive: true });
  await fs.promises.mkdir(segmentsDir, { recursive: true });

  // ---- Plan: validate + deduplicate up front, before any async work.
  // Validation failures here surface synchronously instead of mid-download.
  const sourcePaths = new Map<string, string>();
  const remoteKeys = new Map<string, string>();
  const uniqueCuts = new Map<string, CutPlan>();
  const timelineCutKeys: string[] = [];

  for (const pick of timeline) {
    const sourceVideo = sourceVideoMap[pick.video_id];
    if (!sourceVideo) {
      throw new Error(`Clip ${pick.video_id} was picked but is missing from the catalog`);
    }
    const remoteKey = sourceVideo.remote?.key;
    if (!remoteKey) {
      throw new Error(`Clip ${pick.video_id} exists in the catalog but has no R2 video object`);
    }

    if (!sourcePaths.has(pick.video_id)) {
      const ext = path.extname(sourceVideo.filename || "") || ".mp4";
      sourcePaths.set(pick.video_id, path.join(sourcesDir, `${safeId(pick.video_id)}${ext}`));
      remoteKeys.set(pick.video_id, remoteKey);
    }

    const key = pickKey(pick);
    timelineCutKeys.push(key);

    if (!uniqueCuts.has(key)) {
      const { audioDur, seekStart, decodeDur, padDur } = narrativeDecodeFromPick(pick);
      if (!(audioDur > 0) || !(decodeDur > 0)) {
        throw new Error(`Timeline pick ${pick.segment_id} has a non-positive decodable duration`);
      }
      const mediaId = `render-${safeId(pick.video_id)}-${key}`;
      const outputPath = path.join(segmentsDir, `${mediaId}.mp4`);
      uniqueCuts.set(key, {
        key, pick, sourceVideo, audioDur, seekStart, decodeDur, padDur, mediaId, outputPath,
      });
    }
  }

  try {
    // Pass 1: download distinct source videos in parallel.
    const downloadJobs = Array.from(sourcePaths.entries()).map(([vid, sourcePath]) => ({
      vid, sourcePath, remoteKey: remoteKeys.get(vid)!,
    }));
    await mapWithConcurrency(downloadJobs, DOWNLOAD_CONCURRENCY, (job) =>
      downloadObject(job.remoteKey, job.sourcePath),
    );

    // Pass 2: cut distinct segments in parallel.
    const cutPlans = Array.from(uniqueCuts.values());
    await mapWithConcurrency(cutPlans, CUT_CONCURRENCY, (plan) =>
      cutSegment({
        sourcePath: sourcePaths.get(plan.pick.video_id)!,
        outputPath: plan.outputPath,
        start: plan.seekStart,
        decodeDur: plan.decodeDur,
        padDur: plan.padDur,
        jobId,
      }),
    );

    // Pass 3: build outputs in original timeline order.
    const preparedByKey = new Map<string, { mediaId: string; media: RenderReadyMedia }>();
    const preparedTimeline: ResolvedPick[] = [];
    const preparedVideoMap: Record<string, ParsedVideo> = {};
    const media: RenderReadyMedia[] = [];

    for (let i = 0; i < timeline.length; i++) {
      const pick = timeline[i];
      const plan = uniqueCuts.get(timelineCutKeys[i])!;

      let prepared = preparedByKey.get(plan.key);
      if (!prepared) {
        const readyMedia: RenderReadyMedia = {
          filePath: plan.outputPath,
          duration: plan.audioDur,
          segmentId: pick.segment_id,
          videoId: pick.video_id,
        };
        prepared = { mediaId: plan.mediaId, media: readyMedia };
        preparedByKey.set(plan.key, prepared);
        media.push(readyMedia);
        preparedVideoMap[plan.mediaId] = {
          ...plan.sourceVideo,
          id: plan.mediaId,
          filename: path.basename(plan.outputPath),
          path: plan.outputPath,
          availability: "local",
          duration_sec: plan.audioDur,
          segments: [{
            id: pick.segment_id,
            start_sec: 0,
            end_sec: plan.audioDur,
            description: "",
            tags: [],
          }],
        };
      }

      preparedTimeline.push({
        ...pick,
        video_id: prepared.mediaId,
        video_start: 0,
        video_end: prepared.media.duration,
      });
    }

    return {
      timeline: preparedTimeline,
      videoMap: preparedVideoMap,
      media,
      tempDir,
      cleanup: async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
      },
    };
  } catch (err) {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    throw err;
  }
}
