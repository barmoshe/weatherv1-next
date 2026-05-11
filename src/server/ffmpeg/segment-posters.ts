import path from "node:path";
import { generateAt, generatePoster, posterPath } from "./posters";
import type { ParsedVideo, NormalisedSegment } from "@/shared/types";

const SEGMENT_POSTERS_DIR = path.join(process.cwd(), "runtime", "cache", "segment_posters");
const CLIP_POSTERS_DIR = path.join(process.cwd(), "runtime", "cache", "posters");

export async function generateSegmentPoster(
  segId: string,
  videoMap: Record<string, ParsedVideo>,
  force = false
): Promise<string | null> {
  // Parse clip ID from segId (e.g. "IB003-s2" → "IB003")
  const idx = segId.lastIndexOf("-s");
  const clipId = idx === -1 ? segId : segId.slice(0, idx);

  const clip = videoMap[clipId];
  if (!clip) return null;

  const seg = clip.segments.find((s) => s.id === segId);

  // Single-segment shortcut: fall through to clip poster
  if (!seg || clip.segments.length <= 1) {
    return generatePoster(clip.path, clipId, CLIP_POSTERS_DIR, force);
  }

  const midpoint = (seg.start_sec + seg.end_sec) / 2;
  return generateAt(clip.path, segId, midpoint, SEGMENT_POSTERS_DIR, force);
}
