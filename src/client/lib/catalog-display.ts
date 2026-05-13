import type { NormalisedSegment, ParsedVideo } from "@/shared/types";
import { labelFor } from "./tag-labels";

export interface CatalogSegmentStats {
  total: number;
  tagged: number;
  described: number;
  empty: number;
}

export interface CatalogSegmentPreview {
  id: string;
  description: string;
  timeRange: string;
  tags: string[];
}

export function catalogVideoTitle(video: ParsedVideo): string {
  const description = (video.description ?? "").trim();
  if (description) return description;

  for (const segment of video.segments ?? []) {
    const segmentDescription = (segment.description ?? "").trim();
    if (segmentDescription) return segmentDescription;
  }

  return video.filename || video.id;
}

export function catalogVideoMeta(video: ParsedVideo): string {
  return [video.id, video.filename].filter(Boolean).join(" · ");
}

export function catalogDurationLabel(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "";
  return `${Math.round(seconds)} שנ׳`;
}

function formatSegmentTime(seconds: number): string {
  const safeSeconds = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const mins = Math.floor(safeSeconds / 60);
  const secs = Math.floor(safeSeconds % 60);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function segmentTimeRange(segment: Pick<NormalisedSegment, "start_sec" | "end_sec">): string {
  return `${formatSegmentTime(segment.start_sec)}-${formatSegmentTime(segment.end_sec)}`;
}

export function availabilityLabel(video: ParsedVideo): string {
  if (video.availability === "local") return "במטמון";
  if (video.availability === "cloud_only") return "בענן";
  if (video.availability === "syncing") return "מסנכרן";
  return "שגיאה";
}

export function availabilityLongLabel(video: ParsedVideo): string {
  if (video.availability === "cloud_only") return "בענן, לא במטמון המקומי";
  if (video.availability === "local") return "זמין במטמון המקומי";
  return availabilityLabel(video);
}

export function allCatalogTags(video: ParsedVideo): string[] {
  const tags: string[] = [];
  for (const segment of video.segments ?? []) {
    for (const tag of segment.tags ?? []) {
      if (tag) tags.push(tag);
    }
  }

  const legacyTags = video.tags;
  if (legacyTags) {
    if (Array.isArray(legacyTags)) {
      for (const tag of legacyTags) {
        if (tag) tags.push(tag);
      }
    } else {
      for (const tag of [legacyTags.main, legacyTags.secondary, legacyTags.third]) {
        if (tag) tags.push(tag);
      }
    }
  }

  return tags;
}

export function hasAnyCatalogTag(video: ParsedVideo): boolean {
  return allCatalogTags(video).length > 0;
}

export function videoMatchesTags(video: ParsedVideo, activeTags: string[]): boolean {
  if (activeTags.length === 0) return true;
  const tags = new Set(allCatalogTags(video));
  return activeTags.every((tag) => tags.has(tag));
}

export function topCatalogTags(video: ParsedVideo, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const tag of allCatalogTags(video)) {
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1] || labelFor(a[0]).localeCompare(labelFor(b[0]), "he"))
    .slice(0, limit)
    .map(([tag]) => tag);
}

export function segmentListStats(segments: NormalisedSegment[]): CatalogSegmentStats {
  return segments.reduce<CatalogSegmentStats>(
    (stats, segment) => {
      const hasDescription = Boolean((segment.description ?? "").trim());
      const hasTags = (segment.tags ?? []).length > 0;

      stats.total += 1;
      if (hasTags) stats.tagged += 1;
      if (hasDescription) stats.described += 1;
      if (!hasDescription && !hasTags) stats.empty += 1;
      return stats;
    },
    { total: 0, tagged: 0, described: 0, empty: 0 }
  );
}

export function catalogSegmentStats(video: ParsedVideo): CatalogSegmentStats {
  return segmentListStats(video.segments ?? []);
}

function segmentSearchText(segment: NormalisedSegment): string {
  return [
    segment.id,
    segment.description,
    ...(segment.tags ?? []),
    ...(segment.tags ?? []).map(labelFor),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("he");
}

function segmentPreviewScore(segment: NormalisedSegment, needle: string): number {
  let score = 0;
  const description = (segment.description ?? "").trim();
  const tags = segment.tags ?? [];

  if (needle && segmentSearchText(segment).includes(needle)) score += 100;
  if (description) score += 10;
  if (tags.length > 0) score += 5;
  score += Math.max(0, 2 - Math.abs(segment.start_sec));
  return score;
}

export function catalogSegmentPreviews(
  video: ParsedVideo,
  query = "",
  limit = 3
): CatalogSegmentPreview[] {
  const needle = query.trim().toLocaleLowerCase("he");
  return [...(video.segments ?? [])]
    .sort((a, b) => {
      const score = segmentPreviewScore(b, needle) - segmentPreviewScore(a, needle);
      return score || a.start_sec - b.start_sec || a.id.localeCompare(b.id);
    })
    .slice(0, limit)
    .map((segment) => ({
      id: segment.id,
      description: (segment.description ?? "").trim(),
      timeRange: segmentTimeRange(segment),
      tags: segment.tags ?? [],
    }));
}

export function matchesCatalogSearch(video: ParsedVideo, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase("he");
  if (!needle) return true;

  const searchable = [
    video.id,
    video.filename,
    video.description,
    video.source,
    video.source ? labelFor(video.source) : "",
    catalogVideoTitle(video),
    ...(video.segments ?? []).flatMap((segment) => [
      segment.id,
      segment.description,
      ...(segment.tags ?? []),
      ...(segment.tags ?? []).map(labelFor),
    ]),
    ...allCatalogTags(video),
    ...allCatalogTags(video).map(labelFor),
  ]
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase("he");

  return searchable.includes(needle);
}
