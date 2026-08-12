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

async function seekSeconds(videoPath: string, knownDurationSec?: number): Promise<number> {
  // The catalog already knows most durations; a caller passing one saves an
  // ffprobe spawn per cache-miss poster.
  let dur = knownDurationSec ?? 0;
  if (!(dur > 0)) {
    try {
      dur = (await probeVideo(videoPath)).durationSec;
    } catch {
      return 1;
    }
  }
  if (dur <= 0) return 0;
  if (dur < 2) return Math.max(0, dur / 2);
  return 1;
}

// ffmpeg spawns are CPU-heavy and a cold catalog grid requests many posters
// at once; cap concurrent generations machine-wide.
const MAX_CONCURRENT_GENERATIONS = 3;
let activeGenerations = 0;
const generationQueue: Array<() => void> = [];

async function acquireGenerationSlot(): Promise<void> {
  if (activeGenerations < MAX_CONCURRENT_GENERATIONS) {
    activeGenerations += 1;
    return;
  }
  await new Promise<void>((resolve) => generationQueue.push(resolve));
  activeGenerations += 1;
}

function releaseGenerationSlot(): void {
  activeGenerations -= 1;
  generationQueue.shift()?.();
}

// Concurrent requests can ask for the same poster (the clip route and the
// segment route's single-segment fallback share an outId): join the in-flight
// generation instead of racing two ffmpeg writes into one target.
const inFlight = new Map<string, Promise<string | null>>();
let tmpSeq = 0;

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
  const existing = inFlight.get(outPath);
  if (existing) return existing;
  const job = (async () => {
    await acquireGenerationSlot();
    try {
      return await generateAtExclusive(videoPath, outId, seekSec, outPath, postersDir);
    } finally {
      releaseGenerationSlot();
    }
  })();
  inFlight.set(outPath, job);
  try {
    return await job;
  } finally {
    inFlight.delete(outPath);
  }
}

async function generateAtExclusive(
  videoPath: string,
  outId: string,
  seekSec: number,
  outPath: string,
  postersDir: string,
): Promise<string | null> {
  fs.mkdirSync(postersDir, { recursive: true });
  // Unique per attempt: a same-path .tmp would be truncated (-y) by any
  // concurrent writer that slipped past the in-flight map (multi-process).
  const tmpPath = `${outPath}.${process.pid}-${++tmpSeq}.tmp`;
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
  force = false,
  knownDurationSec?: number
): Promise<string | null> {
  if (!force && isCached(outId, videoPath, postersDir)) {
    return posterPath(outId, postersDir);
  }
  const seek = await seekSeconds(videoPath, knownDurationSec);
  return generateAt(videoPath, outId, seek, postersDir, force);
}
