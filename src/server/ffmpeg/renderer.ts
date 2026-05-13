import fs from "node:fs";
import { spawnFFmpeg } from "./spawn";
import { probeVideo } from "./probe";
import { getFFmpegPath } from "./binaries";
import type { ResolvedPick, ParsedVideo } from "@/shared/types";
import { getAssetSource } from "@/server/assets/source";
import { narrativeDecodeFromPick } from "@/server/ffmpeg/timeline-clip-timing";

const PAD_THRESHOLD_SEC = 0.04;

export interface RenderOptions {
  jobId?: string;
  bgMusicPath?: string;
  bgMusicVolume?: string;
  onProgress?: (pct: number) => void;
}

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
  // Resolve timeline: decode up to decodeDur from source at seekStart, then freeze-pad so each slice equals audioDur.
  type Resolved = {
    filePath: string;
    seekStart: number;
    decodeDur: number;
    audioDur: number;
    padDur: number;
  };
  const resolved: Resolved[] = [];

  for (const clip of timeline) {
    const vid = videoMap[clip.video_id];
    if (!vid) {
      console.warn(`Warning: Video ${clip.video_id} not found in map. Skipping.`);
      continue;
    }
    const { audioDur, seekStart, decodeDur, padDur } = narrativeDecodeFromPick(clip);
    if (audioDur <= 0 || decodeDur <= 0) {
      console.warn(`Warning: Timeline pick ${clip.segment_id} has no decodable duration; skipping.`);
      continue;
    }
    resolved.push({ filePath: vid.path, seekStart, decodeDur, audioDur, padDur });
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

  // One -i entry per resolved clip (each decodes up to decodeDur from seekStart; pad in filter graph to audioDur)
  for (const { filePath, seekStart, decodeDur } of resolved) {
    args.push("-ss", String(seekStart), "-t", String(decodeDur), "-i", filePath);
    inputFiles.push(filePath);
  }

  // Audio input(s)
  const audioInputIdx = resolved.length;
  args.push("-i", audioPath);
  inputFiles.push(audioPath);

  let bgMusicInputIdx: number | null = null;
  // Resolve via the asset source so it can fall back to the bundled
  // canonical file shipped with the app when the workspace copy is missing.
  const bgMusicPath = opts.bgMusicPath ?? getAssetSource().getDefaultBgMusicPath();
  if (fs.existsSync(bgMusicPath)) {
    args.push("-stream_loop", "-1", "-i", bgMusicPath);
    bgMusicInputIdx = resolved.length + 1;
    inputFiles.push(bgMusicPath);
  } else {
    console.warn(`bg music not found at ${bgMusicPath}; rendering without music.`);
  }

  // Filter complex
  const filterParts: string[] = [];

  // Per-clip: trim decoded window → scale/crop → optional freeze to match narration length
  const scaleCrop =
    "scale=1080:1920:force_original_aspect_ratio=increase," +
    "crop=1080:1920,setsar=1";
  for (let i = 0; i < resolved.length; i++) {
    const { decodeDur, padDur } = resolved[i];
    const MIN_PAD_RENDER = 1e-6;
    const tpad =
      padDur > MIN_PAD_RENDER ? `,tpad=stop_mode=clone:stop_duration=${padDur}` : "";
    filterParts.push(
      `[${i}:v]trim=start=0:duration=${decodeDur},setpts=PTS-STARTPTS,` +
        `${scaleCrop}${tpad}[v${i}]`
    );
  }

  // Concat all clip video streams
  const concatInputs = resolved.map((_, i) => `[v${i}]`).join("");
  const totalVideoDur = resolved.reduce((s, r) => s + r.audioDur, 0);

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
    // Bare input stream reference: `-map N:a`. Wrapping it in brackets makes
    // ffmpeg look up a filter-graph label named `N:a`, which does not exist
    // and fails with "Output with label 'N:a' does not exist in any defined
    // filter graph" → "Error opening output files: Invalid argument".
    audioOut = `${audioInputIdx}:a`;
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
