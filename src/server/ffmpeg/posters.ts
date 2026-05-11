import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getFFmpegPath } from "./binaries";
import { probeVideo } from "./probe";

const execFileAsync = promisify(execFile);
const POSTER_WIDTH = 480;

export function posterPath(outId: string, postersDir: string): string {
  return path.join(postersDir, `${outId}.jpg`);
}

function isCached(outId: string, videoPath: string, postersDir: string): boolean {
  const p = posterPath(outId, postersDir);
  if (!fs.existsSync(p)) return false;
  try {
    return fs.statSync(p).mtimeMs >= fs.statSync(videoPath).mtimeMs;
  } catch {
    return false;
  }
}

async function seekSeconds(videoPath: string): Promise<number> {
  try {
    const probe = await probeVideo(videoPath);
    const dur = probe.durationSec;
    if (dur <= 0) return 0;
    if (dur < 2) return Math.max(0, dur / 2);
    return 1;
  } catch {
    return 1;
  }
}

export async function generateAt(
  videoPath: string,
  outId: string,
  seekSec: number,
  postersDir: string,
  force = false
): Promise<string | null> {
  if (!fs.existsSync(videoPath)) {
    console.warn(`poster: source missing for ${outId}: ${videoPath}`);
    return null;
  }
  const outPath = posterPath(outId, postersDir);
  if (!force) {
    try {
      if (
        fs.existsSync(outPath) &&
        fs.statSync(outPath).mtimeMs >= fs.statSync(videoPath).mtimeMs
      ) {
        return outPath;
      }
    } catch { /* ignore */ }
  }
  fs.mkdirSync(postersDir, { recursive: true });
  const tmpPath = `${outPath}.tmp`;
  const seek = Math.max(0, seekSec);
  try {
    await execFileAsync(getFFmpegPath(), [
      "-ss", String(seek),
      "-i", videoPath,
      "-vframes", "1",
      "-vf", `scale=${POSTER_WIDTH}:-2`,
      "-qscale:v", "4",
      "-f", "image2",
      "-vcodec", "mjpeg",
      "-loglevel", "error",
      "-y", tmpPath,
    ]);
  } catch (err) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    console.warn(`poster: ffmpeg failed for ${outId}:`, err);
    return null;
  }
  if (!fs.existsSync(tmpPath) || fs.statSync(tmpPath).size === 0) {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    console.warn(`poster: empty output for ${outId}`);
    return null;
  }
  fs.renameSync(tmpPath, outPath);
  return outPath;
}

export async function generatePoster(
  videoPath: string,
  outId: string,
  postersDir: string,
  force = false
): Promise<string | null> {
  if (!force && isCached(outId, videoPath, postersDir)) {
    return posterPath(outId, postersDir);
  }
  const seek = await seekSeconds(videoPath);
  return generateAt(videoPath, outId, seek, postersDir, force);
}
