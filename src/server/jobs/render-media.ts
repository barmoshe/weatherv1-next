import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { downloadR2File } from "@/server/sync/r2/client";
import { getRuntimePaths } from "@/server/runtime/paths";
import { spawnFFmpeg } from "@/server/ffmpeg/spawn";
import { getFFmpegPath } from "@/server/ffmpeg/binaries";
import type { ParsedVideo, ResolvedPick } from "@/shared/types";

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
    duration: number;
    jobId?: string;
  }) => Promise<void>;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/g, "-");
}

function pickDuration(pick: ResolvedPick): number {
  const start = pick.video_start ?? 0;
  const end = pick.video_end ?? start + Math.max(0, pick.audio_end - pick.audio_start);
  return Math.max(0, end - start);
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
  duration: number;
  jobId?: string;
}): Promise<void> {
  await fs.promises.mkdir(path.dirname(args.outputPath), { recursive: true });
  const result = await spawnFFmpeg(getFFmpegPath(), [
    "-ss", String(args.start),
    "-t", String(args.duration),
    "-i", args.sourcePath,
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

  const sourcePaths = new Map<string, string>();
  const preparedByPick = new Map<string, { mediaId: string; media: RenderReadyMedia }>();
  const preparedTimeline: ResolvedPick[] = [];
  const preparedVideoMap: Record<string, ParsedVideo> = {};
  const media: RenderReadyMedia[] = [];

  try {
    for (const pick of timeline) {
      const sourceVideo = sourceVideoMap[pick.video_id];
      if (!sourceVideo) {
        throw new Error(`Clip ${pick.video_id} was picked but is missing from the catalog`);
      }

      const remoteKey = sourceVideo.remote?.key;
      if (!remoteKey) {
        throw new Error(`Clip ${pick.video_id} exists in the catalog but has no R2 video object`);
      }

      let sourcePath = sourcePaths.get(pick.video_id);
      if (!sourcePath) {
        const ext = path.extname(sourceVideo.filename || "") || ".mp4";
        sourcePath = path.join(sourcesDir, `${safeId(pick.video_id)}${ext}`);
        await downloadObject(remoteKey, sourcePath);
        sourcePaths.set(pick.video_id, sourcePath);
      }

      const key = pickKey(pick);
      const duration = pickDuration(pick);
      if (!(duration > 0)) {
        throw new Error(`Timeline pick ${pick.segment_id} has a non-positive duration`);
      }

      let prepared = preparedByPick.get(key);
      if (!prepared) {
        const mediaId = `render-${safeId(pick.video_id)}-${key}`;
        const outputPath = path.join(segmentsDir, `${mediaId}.mp4`);
        await cutSegment({
          sourcePath,
          outputPath,
          start: pick.video_start ?? 0,
          duration,
          jobId,
        });
        const readyMedia = {
          filePath: outputPath,
          duration,
          segmentId: pick.segment_id,
          videoId: pick.video_id,
        };
        prepared = { mediaId, media: readyMedia };
        preparedByPick.set(key, prepared);
        media.push(readyMedia);
        preparedVideoMap[mediaId] = {
          ...sourceVideo,
          id: mediaId,
          filename: path.basename(outputPath),
          path: outputPath,
          availability: "local",
          duration_sec: duration,
          segments: [{
            id: pick.segment_id,
            start_sec: 0,
            end_sec: duration,
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
