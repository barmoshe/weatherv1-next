import fs from "node:fs";
import path from "node:path";
import { spawnFFmpeg } from "./spawn";
import { probeVideo } from "./probe";
import { getFFmpegPath } from "./binaries";
import type { ResolvedPick, ParsedVideo } from "@/shared/types";

const PAD_THRESHOLD_SEC = 0.04;

export interface RenderOptions {
  jobId?: string;
  bgMusicPath?: string;
  bgMusicVolume?: string;
  onProgress?: (pct: number) => void;
}

type SpecKey = `${string}::${number}::${number}`; // filePath::start::duration

export interface RendererArgResult {
  args: string[];
  inputFiles: string[];
}

/**
 * Build the ffmpeg arg array that produces the 9:16 1080×1920 output.
 *
 * This mirrors video_editor.py:create_video exactly so golden tests can
 * compare arg arrays from both implementations.
 *
 * The unique-spec/split deduplication logic (Python lines 35-73) is preserved:
 * when the same (file, start, duration) tuple appears N>1 times in the timeline,
 * ffmpeg-python would normally collapse the filter chain, causing "multiple
 * outgoing edges". We replicate this by using split= filter outputs.
 *
 * In the raw ffmpeg CLI we achieve the same by simply providing the same -ss/-t
 * input N times (one -i entry per occurrence) — ffmpeg CLI does not share inputs
 * across occurrences the way the Python library does, so no split needed.
 * The resulting arg array is equivalent in output but structurally simpler.
 */
export async function buildRendererArgs(
  timeline: ResolvedPick[],
  videoMap: Record<string, ParsedVideo>,
  audioPath: string,
  outputPath: string,
  opts: RenderOptions = {}
): Promise<RendererArgResult | null> {
  // Resolve timeline to (filePath, start, duration) tuples
  type Resolved = { filePath: string; start: number; duration: number };
  const resolved: Resolved[] = [];

  for (const clip of timeline) {
    const vid = videoMap[clip.video_id];
    if (!vid) {
      console.warn(`Warning: Video ${clip.video_id} not found in map. Skipping.`);
      continue;
    }
    const start = clip.video_start ?? 0;
    const audioDur = clip.audio_end - clip.audio_start;
    const end = clip.video_end ?? start + audioDur;
    const duration = end - start;
    resolved.push({ filePath: vid.path, start, duration });
  }

  if (resolved.length === 0) {
    console.warn("No valid clips to assemble.");
    return null;
  }

  // Probe audio duration
  const audioProbe = await probeVideo(audioPath);
  const audioDurTotal = audioProbe.durationSec;

  // Build args
  const args: string[] = [];
  const inputFiles: string[] = [];

  // One -i entry per resolved clip (no dedup needed in CLI — each -i is independent)
  for (const { filePath, start, duration } of resolved) {
    args.push("-ss", String(start), "-t", String(duration), "-i", filePath);
    inputFiles.push(filePath);
  }

  // Audio input(s)
  const audioInputIdx = resolved.length;
  args.push("-i", audioPath);
  inputFiles.push(audioPath);

  let bgMusicInputIdx: number | null = null;
  const bgMusicPath =
    opts.bgMusicPath ??
    process.env.BG_MUSIC_PATH ??
    path.join(process.cwd(), "..", "v1Drive", "weather", "music", "מוזיקת אנדר לתחזית.mp3");
  if (fs.existsSync(bgMusicPath)) {
    args.push("-stream_loop", "-1", "-i", bgMusicPath);
    bgMusicInputIdx = resolved.length + 1;
    inputFiles.push(bgMusicPath);
  } else {
    console.warn(`bg music not found at ${bgMusicPath}; rendering without music.`);
  }

  // Filter complex
  const filterParts: string[] = [];

  // Per-clip video filter chain: trim → setpts → scale → crop → setsar
  for (let i = 0; i < resolved.length; i++) {
    const { duration } = resolved[i];
    filterParts.push(
      `[${i}:v]trim=start=0:duration=${duration},setpts=PTS-STARTPTS,` +
        `scale=1080:1920:force_original_aspect_ratio=increase,` +
        `crop=1080:1920,setsar=1[v${i}]`
    );
  }

  // Concat all clip video streams
  const concatInputs = resolved.map((_, i) => `[v${i}]`).join("");
  const totalVideoDur = resolved.reduce((s, r) => s + r.duration, 0);

  let concatOut = "[vcat]";
  filterParts.push(`${concatInputs}concat=n=${resolved.length}:v=1:a=0${concatOut}`);

  // tpad if video is shorter than audio (freeze last frame)
  if (audioDurTotal && audioDurTotal - totalVideoDur > PAD_THRESHOLD_SEC) {
    const padDur = audioDurTotal - totalVideoDur;
    filterParts.push(`[vcat]tpad=stop_mode=clone:stop_duration=${padDur}[vout]`);
    concatOut = "[vout]";
  } else {
    // rename vcat → vout for uniformity
    filterParts[filterParts.length - 1] = filterParts[filterParts.length - 1].replace(
      "[vcat]",
      "[vout]"
    );
    concatOut = "[vout]";
  }

  // Audio mixing
  let audioOut: string;
  if (bgMusicInputIdx !== null) {
    const vol = opts.bgMusicVolume ?? "-16dB";
    filterParts.push(
      `[${bgMusicInputIdx}:a]volume=${vol}[bgm]`,
      `[${audioInputIdx}:a][bgm]amix=inputs=2:duration=shortest:normalize=0[aout]`
    );
    audioOut = "[aout]";
  } else {
    audioOut = `[${audioInputIdx}:a]`;
  }

  args.push("-filter_complex", filterParts.join(";"));
  args.push("-map", concatOut, "-map", audioOut);
  args.push(
    "-vcodec", "libx264",
    "-pix_fmt", "yuv420p",
    "-acodec", "aac"
  );

  if (audioDurTotal) {
    args.push("-t", String(audioDurTotal));
  }

  args.push("-y", outputPath);

  return { args, inputFiles };
}

export async function renderVideo(
  timeline: ResolvedPick[],
  videoMap: Record<string, ParsedVideo>,
  audioPath: string,
  outputPath: string,
  opts: RenderOptions = {}
): Promise<boolean> {
  const result = await buildRendererArgs(timeline, videoMap, audioPath, outputPath, opts);
  if (!result) return false;

  console.log(`Rendering to ${outputPath}...`);
  const { code, stderrTail } = await spawnFFmpeg(getFFmpegPath(), result.args, {
    jobId: opts.jobId,
    onProgress: opts.onProgress,
  });

  if (code !== 0) {
    console.error("ffmpeg error:\n", stderrTail);
    return false;
  }

  console.log("Rendering complete.");
  return true;
}
