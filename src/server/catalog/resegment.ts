/**
 * Catalog re-segmentation helper.
 *
 * Splits each segment whose duration is strictly greater than `splitAbove`
 * seconds into N equal-length consecutive windows where every window is
 * guaranteed to be at least `minWindow` seconds long.
 *
 *   N = floor(duration / minWindow)   (so duration / N >= minWindow)
 *
 * The first new window inherits the original segment's `tags`,
 * `description`, and `confidence`. The remaining windows have empty tags,
 * empty description, and no `confidence` — they are blank slates that the
 * tagger / editor can fill in later.
 *
 * Segments at or below `splitAbove` are kept as-is. Segment IDs in the
 * returned video are always rebuilt as `${videoId}-s${i}` so the array is
 * dense and ordered.
 *
 * The function is pure: it takes a `Catalog` and returns a new `Catalog`
 * plus a per-video change log; the on-disk file is the script's concern.
 */

import type { Catalog, CatalogEntry, SegmentEntry } from "@/shared/types";

export interface ResegmentOptions {
  /** Minimum length, in seconds, of every window after a split. */
  minWindow: number;
  /** Only segments strictly longer than this (seconds) get split. */
  splitAbove: number;
}

export interface VideoChange {
  videoId: string;
  oldCount: number;
  newCount: number;
  /** Per-input-segment window count. 1 means "left untouched". */
  splitsBySegment: number[];
}

export interface ResegmentResult {
  catalog: Catalog;
  changes: VideoChange[];
  summary: {
    videos: number;
    videosChanged: number;
    segmentsBefore: number;
    segmentsAfter: number;
  };
}

const DEFAULT_OPTIONS: ResegmentOptions = {
  minWindow: 9,
  splitAbove: 29,
};

function roundTo(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function splitSegment(
  segment: SegmentEntry,
  opts: ResegmentOptions,
): SegmentEntry[] {
  const duration = segment.end_sec - segment.start_sec;

  if (!Number.isFinite(duration) || duration <= opts.splitAbove) {
    return [segment];
  }

  const n = Math.floor(duration / opts.minWindow);
  if (n <= 1) return [segment];

  const windowLen = duration / n;
  const out: SegmentEntry[] = [];
  for (let i = 0; i < n; i++) {
    const isFirst = i === 0;
    const isLast = i === n - 1;
    const start = segment.start_sec + windowLen * i;
    // Snap the last window's end to the original end so floating point
    // drift cannot push us past it or leave a sub-millisecond gap.
    const end = isLast ? segment.end_sec : segment.start_sec + windowLen * (i + 1);

    const piece: SegmentEntry = {
      start_sec: roundTo(start, 3),
      end_sec: roundTo(end, 3),
      description: isFirst ? (segment.description ?? "") : "",
      tags: isFirst ? [...(segment.tags ?? [])] : [],
    };
    if (isFirst && typeof segment.confidence === "number") {
      piece.confidence = segment.confidence;
    }
    out.push(piece);
  }
  return out;
}

function resegmentVideo(
  entry: CatalogEntry,
  opts: ResegmentOptions,
): { entry: CatalogEntry; change: VideoChange } {
  const inputSegments = entry.segments ?? [];
  const splitsBySegment: number[] = [];
  const rebuilt: SegmentEntry[] = [];

  for (const seg of inputSegments) {
    const pieces = splitSegment(seg, opts);
    splitsBySegment.push(pieces.length);
    rebuilt.push(...pieces);
  }

  const withIds = rebuilt.map((seg, i) => ({
    ...seg,
    id: `${entry.id}-s${i}`,
  }));

  return {
    entry: { ...entry, segments: withIds },
    change: {
      videoId: entry.id,
      oldCount: inputSegments.length,
      newCount: withIds.length,
      splitsBySegment,
    },
  };
}

export function resegmentCatalog(
  catalog: Catalog,
  options: Partial<ResegmentOptions> = {},
): ResegmentResult {
  const opts: ResegmentOptions = { ...DEFAULT_OPTIONS, ...options };
  if (!(opts.minWindow > 0) || !(opts.splitAbove > 0)) {
    throw new Error(
      `resegmentCatalog: minWindow and splitAbove must be > 0 (got ${opts.minWindow}, ${opts.splitAbove})`,
    );
  }

  const changes: VideoChange[] = [];
  let segmentsBefore = 0;
  let segmentsAfter = 0;
  let videosChanged = 0;

  const videos = catalog.videos.map((entry) => {
    const { entry: nextEntry, change } = resegmentVideo(entry, opts);
    changes.push(change);
    segmentsBefore += change.oldCount;
    segmentsAfter += change.newCount;
    if (change.newCount !== change.oldCount) videosChanged++;
    return nextEntry;
  });

  return {
    catalog: { ...catalog, videos, updated_at: new Date().toISOString() },
    changes,
    summary: {
      videos: catalog.videos.length,
      videosChanged,
      segmentsBefore,
      segmentsAfter,
    },
  };
}
