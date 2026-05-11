import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFFmpegPath } from "./binaries";
import { probeVideo } from "./probe";

const execFileAsync = promisify(execFile);
const MAX_WIDTH = 1280;
const MAX_HEIGHT = 720;

export function previewPath(vidId: string, previewsDir: string): string {
  return path.join(previewsDir, `${vidId}.mp4`);
}

function isCached(vidId: string, videoPath: string, previewsDir: string): boolean {
  const p = previewPath(vidId, previewsDir);
  if (!fs.existsSync(p)) return false;
  try {
    return fs.statSync(p).mtimeMs >= fs.statSync(videoPath).mtimeMs;
  } catch {
    return false;
  }
}

export async function needsTranscode(videoPath: string): Promise<boolean> {
  const ext = path.extname(videoPath).toLowerCase();
  if (ext !== ".mp4") return true;
  try {
    const probe = await probeVideo(videoPath);
    if (!probe.videoCodec) return true;
    return !(
      probe.videoCodec === "h264" &&
      (probe.pixFmt === "yuv420p" || probe.pixFmt === "yuvj420p")
    );
  } catch {
    return true;
  }
}

export async function getPreviewPath(
  videoPath: string,
  vidId: string,
  previewsDir: string,
  force = false
): Promise<string | null> {
  if (!fs.existsSync(videoPath)) {
    console.warn(`preview: source missing for ${vidId}: ${videoPath}`);
    return null;
  }

  const shouldTranscode = await needsTranscode(videoPath);
  if (!shouldTranscode) return videoPath;

  const outPath = previewPath(vidId, previewsDir);
  if (!force && isCached(vidId, videoPath, previewsDir)) return outPath;

  fs.mkdirSync(previewsDir, { recursive: true });
  const tmpPath = `${outPath}.tmp`;

  const vf =
    `scale='min(${MAX_WIDTH},iw)':'min(${MAX_HEIGHT},ih)':` +
    `force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`;

  try {
    await execFileAsync(getFFmpegPath(), [
      "-i", videoPath,
      "-f", "mp4",
      "-vcodec", "libx264",
      "-pix_fmt", "yuv420p",
      "-preset", "veryfast",
      "-crf", "24",
      "-vf", vf,
      "-acodec", "aac",
      "-b:a", "128k",
      "-movflags", "+faststart",
      "-loglevel", "error",
      "-threads", "0",
      "-y", tmpPath,
    ]);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    console.warn(`preview: ffmpeg failed for ${vidId}:`, err);
    return null;
  }

  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    console.warn(`preview: empty output for ${vidId}`);
    return null;
  }

  fs.renameSync(tmpPath, outPath);
  return outPath;
}
