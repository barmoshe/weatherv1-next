// Browser build: posters are frame grabs through WebCodecs, cached in the
// library folder (.weatherv1/runtime/cache/posters) like the ffmpeg version.
import path from "node:path";
import fs from "node:fs";
import { frameJpeg } from "../../../media/video";
import { readExternal, registerExternal, toFolderPath } from "../../../runtime/vfs";
import * as folder from "../../../runtime/folder";

const POSTER_WIDTH = 480;
const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];
const inFlight = new Map<string, Promise<string | null>>();

export function posterPath(outId: string, postersDir: string): string {
  return path.join(postersDir, `${outId}.jpg`);
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  else active += 1;
  try {
    return await fn();
  } finally {
    const next = queue.shift();
    if (next) next();
    else active -= 1;
  }
}

export async function generateAt(
  videoPath: string,
  outId: string,
  seekSec: number,
  postersDir: string,
  force = false,
): Promise<string | null> {
  if (!fs.existsSync(videoPath)) return null;
  const outPath = posterPath(outId, postersDir);
  if (!force && fs.existsSync(outPath)) return outPath;
  const existing = inFlight.get(outPath);
  if (existing) return existing;
  const job = slot(async () => {
    try {
      const jpeg = await frameJpeg(await readExternal(videoPath), seekSec, POSTER_WIDTH);
      const rel = toFolderPath(outPath);
      if (!jpeg || !rel) return null;
      await folder.writeFile(rel, jpeg);
      registerExternal(outPath, jpeg.size);
      return outPath;
    } catch (err) {
      console.warn(`poster: frame grab failed for ${outId}:`, err);
      return null;
    }
  });
  inFlight.set(outPath, job);
  try {
    return await job;
  } finally {
    inFlight.delete(outPath);
  }
}

export async function generatePoster(
  videoPath: string,
  outId: string,
  postersDir: string,
  force = false,
  knownDurationSec?: number,
): Promise<string | null> {
  const dur = knownDurationSec ?? 0;
  const seek = dur > 0 && dur < 2 ? dur / 2 : 1;
  return generateAt(videoPath, outId, seek, postersDir, force);
}
