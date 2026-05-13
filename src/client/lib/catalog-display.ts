import type { ParsedVideo } from "@/shared/types";
import { labelFor } from "./tag-labels";

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

export function availabilityLabel(video: ParsedVideo): string {
  if (video.availability === "local") return "מקומי";
  if (video.availability === "cloud_only") return "בענן";
  if (video.availability === "syncing") return "מסנכרן";
  return "שגיאה";
}

export function availabilityLongLabel(video: ParsedVideo): string {
  if (video.availability === "cloud_only") return "בענן בלבד";
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
