import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import type {
  Catalog,
  CatalogEntry,
  NormalisedSegment,
  ParsedVideo,
  SegmentMapEntry,
  CatalogFileHealth,
} from "@/shared/types";
import { getCatalogPath, getVideosDir, readCatalog } from "./storage";

// Module-level health state (mirrors Python's LAST_HEALTH)
export let lastHealth: CatalogFileHealth = {
  version: "unknown",
  claimed_count: 0,
  loaded_count: 0,
  missing_ids: [],
};

// ---------------------------------------------------------------------------
// Segment fallback logic
// ---------------------------------------------------------------------------

function parseTimeMmSs(s: string): number {
  const [m, sec] = s.split(":").map(Number);
  return (m || 0) * 60 + (sec || 0);
}

function parseLegacySegments(
  description: string,
  durationSec: number
): NormalisedSegment[] {
  const segments: NormalisedSegment[] = [];
  const re = /(\d{2}:\d{2})\s*[-–]\s*(\d{2}:\d{2})[:\s]*(.*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(description)) !== null) {
    segments.push({
      id: "", // will be assigned by normaliseSegments
      start_sec: parseTimeMmSs(m[1]),
      end_sec: parseTimeMmSs(m[2]),
      description: m[3].trim(),
      tags: [],
    });
  }
  if (segments.length === 0) {
    segments.push({
      id: "",
      start_sec: 0,
      end_sec: durationSec || 0,
      description: (description || "").replace(/\n/g, " ").trim(),
      tags: [],
    });
  }
  return segments;
}

function normaliseSegments(
  entry: CatalogEntry,
  rawSegments: NormalisedSegment[]
): NormalisedSegment[] {
  return rawSegments.map((seg, i) => ({
    ...seg,
    id: seg.id || `${entry.id}-s${i}`,
    tags: seg.tags ?? [],
    description: seg.description ?? "",
  }));
}

// ---------------------------------------------------------------------------
// Main parser
// ---------------------------------------------------------------------------

export function parseCatalog(
  catalog?: Catalog,
  videosDir: string = getVideosDir()
): ParsedVideo[] {
  const cat = catalog ?? readCatalog();

  let version = "unknown";
  try {
    const raw = fs.readFileSync(getCatalogPath(), "utf8");
    version = createHash("sha1").update(raw).digest("hex").slice(0, 8);
  } catch {
    // ignore
  }

  const videos: ParsedVideo[] = [];
  const missingIds: string[] = [];
  const claimedIds: string[] = [];

  for (const entry of cat.videos) {
    if (!entry.id || !entry.filename) continue;
    claimedIds.push(entry.id);

    const filePath = path.join(videosDir, entry.filename);
    const existsLocally = fs.existsSync(filePath);
    if (!existsLocally) {
      missingIds.push(entry.id);
    }

    // Prefer catalog segments[] (AI-tagged), fall back to legacy MM:SS parsing
    const rawSegs: NormalisedSegment[] =
      Array.isArray(entry.segments) && entry.segments.length > 0
        ? (entry.segments as NormalisedSegment[])
        : parseLegacySegments(entry.description ?? "", entry.duration_sec ?? 0);

    const segments = normaliseSegments(entry, rawSegs);

    const remoteStatus = entry.remote?.status;
    const availability =
      existsLocally ? "local" :
      remoteStatus === "syncing" || remoteStatus === "uploading" || remoteStatus === "downloading" ? "syncing" :
      remoteStatus === "error" ? "error" :
      entry.remote?.key ? "cloud_only" :
      "error";

    videos.push({ ...entry, path: filePath, availability, segments });
  }

  lastHealth = {
    version,
    claimed_count: claimedIds.length,
    loaded_count: videos.length,
    missing_ids: missingIds,
  };

  console.log(
    `Catalog ${version}: loaded ${videos.length}/${claimedIds.length} entries` +
      (missingIds.length ? ` (missing: ${missingIds.join(", ")})` : "")
  );

  return videos;
}

// ---------------------------------------------------------------------------
// Segment map (segment_id → {clip, segment})
// ---------------------------------------------------------------------------

export function buildSegmentMap(
  videos: ParsedVideo[]
): Record<string, SegmentMapEntry> {
  const map: Record<string, SegmentMapEntry> = {};
  for (const clip of videos) {
    for (const seg of clip.segments) {
      map[seg.id] = { clip, segment: seg };
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// Video map (video_id → ParsedVideo)
// ---------------------------------------------------------------------------

export function buildVideoMap(videos: ParsedVideo[]): Record<string, ParsedVideo> {
  const map: Record<string, ParsedVideo> = {};
  for (const v of videos) {
    map[v.id] = v;
  }
  return map;
}

// ---------------------------------------------------------------------------
// Tag count helpers
// ---------------------------------------------------------------------------

export interface TagCounts {
  counts: Record<string, number>;
  segment_counts: Record<string, number>;
  source_counts: Record<string, number>;
  total: number;
  total_clips: number;
  total_segments: number;
  multi_segment_clips: number;
  single_segment_clips: number;
  clips_with_no_segments: number;
  remote_available_clips: number;
  remote_missing_clips: number;
  cached_local_clips: number;
  not_cached_local_clips: number;
  cloud_only_clips: number;
  syncing_clips: number;
  error_clips: number;
  untagged: number;
}

export function computeTagCounts(videos: ParsedVideo[]): TagCounts {
  const counts: Record<string, number> = {};
  const segmentCounts: Record<string, number> = {};
  const sourceCounts: Record<string, number> = {};
  let untagged = 0;
  let totalSegments = 0;
  let multiSegmentClips = 0;
  let singleSegmentClips = 0;
  let clipsWithNoSegments = 0;
  let remoteAvailableClips = 0;
  let remoteMissingClips = 0;
  let cachedLocalClips = 0;
  let notCachedLocalClips = 0;
  let cloudOnlyClips = 0;
  let syncingClips = 0;
  let errorClips = 0;

  for (const v of videos) {
    const segmentCount = v.segments?.length ?? 0;
    totalSegments += segmentCount;
    if (segmentCount >= 2) multiSegmentClips++;
    else if (segmentCount === 1) singleSegmentClips++;
    else clipsWithNoSegments++;

    if (v.remote?.key) remoteAvailableClips++;
    else remoteMissingClips++;

    if (v.availability === "local") cachedLocalClips++;
    else notCachedLocalClips++;
    if (v.availability === "cloud_only") cloudOnlyClips++;
    if (v.availability === "syncing") syncingClips++;
    if (v.availability === "error") errorClips++;

    // Clip-level legacy tags
    const lt = v.tags;
    if (lt) {
      for (const val of [lt.main, lt.secondary, lt.third]) {
        if (val) counts[val] = (counts[val] ?? 0) + 1;
      }
    }

    // Source
    if (v.source) sourceCounts[v.source] = (sourceCounts[v.source] ?? 0) + 1;

    // Segment-level tags
    let hasAnySegTag = false;
    for (const seg of v.segments) {
      for (const t of seg.tags ?? []) {
        if (t) {
          segmentCounts[t] = (segmentCounts[t] ?? 0) + 1;
          hasAnySegTag = true;
        }
      }
    }
    if (!hasAnySegTag) untagged++;
  }

  return {
    counts,
    segment_counts: segmentCounts,
    source_counts: sourceCounts,
    total: videos.length,
    total_clips: videos.length,
    total_segments: totalSegments,
    multi_segment_clips: multiSegmentClips,
    single_segment_clips: singleSegmentClips,
    clips_with_no_segments: clipsWithNoSegments,
    remote_available_clips: remoteAvailableClips,
    remote_missing_clips: remoteMissingClips,
    cached_local_clips: cachedLocalClips,
    not_cached_local_clips: notCachedLocalClips,
    cloud_only_clips: cloudOnlyClips,
    syncing_clips: syncingClips,
    error_clips: errorClips,
    untagged,
  };
}
