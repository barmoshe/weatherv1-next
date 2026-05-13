/**
 * Detect and fix catalog rows where a clip is long enough to split on
 * re-segmentation but `segments.length === 1` and the lone segment does
 * not span `splitAbove` seconds (or ends short of the clip duration).
 *
 * `resegmentCatalog` splits by (end_sec - start_sec), not by
 * `duration_sec` alone — wrong/stale segment bounds skip the split.
 */

import type { Catalog, CatalogEntry, SegmentEntry } from "@/shared/types";

export const DEFAULT_REPAIR_SPLIT_ABOVE = 29;
export const DEFAULT_REPAIR_END_SLACK_SEC = 0.25;

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export interface LoneSegmentRepairOptions {
  /** Same threshold as `resegmentCatalog` `splitAbove` (default 29). */
  splitAbove: number;
  /** Treat `end_sec` as short if it is more than this many seconds below effective duration. */
  endSlackSec: number;
}

const DEFAULT_OPTS: LoneSegmentRepairOptions = {
  splitAbove: DEFAULT_REPAIR_SPLIT_ABOVE,
  endSlackSec: DEFAULT_REPAIR_END_SLACK_SEC,
};

/**
 * True iff this entry has exactly one segment, effective catalog/media duration
 * exceeds `splitAbove`, and either the span is at/below `splitAbove` or
 * `end_sec` trails the effective duration.
 */
export function needsLoneSegmentSpanRepair(
  entry: CatalogEntry,
  effectiveDurationSec: number,
  options: Partial<LoneSegmentRepairOptions> = {},
): boolean {
  const { splitAbove, endSlackSec } = { ...DEFAULT_OPTS, ...options };
  const segs = entry.segments ?? [];
  if (segs.length !== 1) return false;
  if (!Number.isFinite(effectiveDurationSec) || effectiveDurationSec <= splitAbove) return false;

  const seg = segs[0]!;
  const span = (seg.end_sec ?? 0) - (seg.start_sec ?? 0);
  if (!Number.isFinite(span)) return false;
  const endShort = seg.end_sec < effectiveDurationSec - endSlackSec;
  const spanTooSmall = span <= splitAbove;
  return spanTooSmall || endShort;
}

export interface RepairCandidateInfo {
  videoId: string;
  filename: string;
  effectiveDurationSec: number;
  before: { start_sec: number; end_sec: number; span: number };
}

/**
 * List entries that need span repair. `getEffectiveDurationSec` must return
 * max(catalog duration_sec, ffprobe) when the file is local, else duration_sec.
 */
export function listLoneSegmentRepairCandidates(
  catalog: Catalog,
  getEffectiveDurationSec: (entry: CatalogEntry) => number,
  options: Partial<LoneSegmentRepairOptions> = {},
): RepairCandidateInfo[] {
  const out: RepairCandidateInfo[] = [];
  for (const entry of catalog.videos) {
    if (!entry.id) continue;
    const effective = getEffectiveDurationSec(entry);
    if (!needsLoneSegmentSpanRepair(entry, effective, options)) continue;
    const seg = (entry.segments ?? [])[0]!;
    const span = (seg.end_sec ?? 0) - (seg.start_sec ?? 0);
    out.push({
      videoId: entry.id,
      filename: entry.filename,
      effectiveDurationSec: effective,
      before: { start_sec: seg.start_sec ?? 0, end_sec: seg.end_sec ?? 0, span },
    });
  }
  return out;
}

/**
 * Return a new `CatalogEntry` where the lone segment covers [0, effectiveDurationSec]
 * (rounded to 3 decimals). Preserves tags, description, confidence, id field.
 * Also sets `duration_sec` / `orientation` when `updates` provided (from ffprobe).
 */
export function repairLoneSegmentSpan(
  entry: CatalogEntry,
  effectiveDurationSec: number,
  clipMeta?: { duration_sec?: number; orientation?: "H" | "V" },
): CatalogEntry {
  const segs = entry.segments ?? [];
  if (segs.length !== 1) return entry;

  const end = roundTo(Math.max(0, effectiveDurationSec), 3);
  const lone = segs[0]!;
  const nextSeg: SegmentEntry = {
    ...lone,
    start_sec: 0,
    end_sec: end,
  };

  return {
    ...entry,
    ...(clipMeta?.duration_sec !== undefined ? { duration_sec: clipMeta.duration_sec } : {}),
    ...(clipMeta?.orientation !== undefined ? { orientation: clipMeta.orientation } : {}),
    segments: [nextSeg],
  };
}

/**
 * Apply span repair to every catalog video that `getEffectiveDurationSec` +
 * `needsLoneSegmentSpanRepair` say needs it.
 */
export function applyLoneSegmentRepairsToCatalog(
  catalog: Catalog,
  getEffectiveDurationSec: (entry: CatalogEntry) => number,
  getClipMeta?: (entry: CatalogEntry) => { duration_sec?: number; orientation?: "H" | "V" } | undefined,
  options: Partial<LoneSegmentRepairOptions> = {},
): Catalog {
  const videos = catalog.videos.map((entry) => {
    const effective = getEffectiveDurationSec(entry);
    if (!needsLoneSegmentSpanRepair(entry, effective, options)) return entry;
    const meta = getClipMeta?.(entry);
    return repairLoneSegmentSpan(entry, effective, meta);
  });
  return { ...catalog, videos, updated_at: new Date().toISOString() };
}
