/**
 * Pure helpers for the "tag every empty segment" handoff.
 *
 * Scope of "empty" matches docs/CATALOG_TAGGING_HANDOFF.md exactly:
 *
 *   (seg.tags ?? []).length === 0 && (seg.description ?? "").trim() === ""
 *
 * `applyTagsToCatalog` only ever mutates `entry.segments[i].tags` and
 * `entry.segments[i].description`. It refuses to touch any other field,
 * refuses to widen TAG_VOCAB (unknown tags are silently dropped — never
 * written to disk), and refuses to overwrite a segment that has picked
 * up tags or a description since the queue was built.
 */

import type {
  Catalog,
  CatalogEntry,
  NormalisedSegment,
  ParsedVideo,
  SegmentEntry,
} from "@/shared/types";
import { isVocabValue } from "@/server/tag-vocab";

export interface EmptySegmentTarget {
  segId: string;
  clipId: string;
  start_sec: number;
  end_sec: number;
}

export interface SegmentTagUpdate {
  segId: string;
  tags: string[];
  description: string;
}

export interface ApplyResult {
  catalog: Catalog;
  applied: number;
  skippedAlreadyTagged: number;
  unknownTagsDropped: number;
  notFound: string[];
}

/**
 * Return every segment whose `tags` is empty AND `description` is empty.
 * Operates on the already-parsed catalog so the caller can also walk
 * sibling tags / clip metadata without re-parsing.
 */
export function selectEmptySegments(videos: ParsedVideo[]): EmptySegmentTarget[] {
  const targets: EmptySegmentTarget[] = [];
  for (const clip of videos) {
    for (const seg of clip.segments) {
      if (isEmpty(seg)) {
        targets.push({
          segId: seg.id,
          clipId: clip.id,
          start_sec: seg.start_sec,
          end_sec: seg.end_sec,
        });
      }
    }
  }
  return targets;
}

function isEmpty(seg: NormalisedSegment | SegmentEntry): boolean {
  const tags = seg.tags ?? [];
  const description = seg.description ?? "";
  return tags.length === 0 && description.trim() === "";
}

/**
 * Apply tag + description updates to a Catalog. Pure — returns a new
 * Catalog plus an audit summary. The caller is responsible for the
 * disk write (writeCatalog) and the R2 push.
 *
 * Per the handoff:
 *   - Unknown tags are silently dropped, never written.
 *   - Already-tagged segments are never overwritten.
 *   - Only `tags` and `description` on the matched segment are mutated.
 *   - Tag de-duplication preserves first-seen order.
 *   - An update with `tags: []` and `description: ""` is a no-op
 *     ("uninformative frame" — leave the segment empty).
 */
export function applyTagsToCatalog(
  catalog: Catalog,
  updates: SegmentTagUpdate[],
): ApplyResult {
  const updateById = new Map<string, SegmentTagUpdate>();
  for (const u of updates) {
    if (u && typeof u.segId === "string" && u.segId) {
      updateById.set(u.segId, u);
    }
  }

  let applied = 0;
  let skippedAlreadyTagged = 0;
  let unknownTagsDropped = 0;
  const seenSegIds = new Set<string>();

  const nextVideos: CatalogEntry[] = catalog.videos.map((entry) => {
    const nextSegments = (entry.segments ?? []).map((seg, i) => {
      const segId = seg.id || `${entry.id}-s${i}`;
      const upd = updateById.get(segId);
      if (!upd) return seg;
      seenSegIds.add(segId);

      if (!isEmpty(seg)) {
        skippedAlreadyTagged++;
        return seg;
      }

      const cleanedTags: string[] = [];
      const dedupe = new Set<string>();
      for (const raw of upd.tags ?? []) {
        if (typeof raw !== "string") {
          unknownTagsDropped++;
          continue;
        }
        const tag = raw.trim();
        if (!tag) continue;
        if (!isVocabValue(tag)) {
          unknownTagsDropped++;
          continue;
        }
        if (dedupe.has(tag)) continue;
        dedupe.add(tag);
        cleanedTags.push(tag);
      }

      const cleanedDescription = (upd.description ?? "").trim();

      if (cleanedTags.length === 0 && cleanedDescription === "") {
        return seg;
      }

      applied++;
      return {
        ...seg,
        tags: cleanedTags,
        description: cleanedDescription,
      };
    });

    return { ...entry, segments: nextSegments };
  });

  const notFound: string[] = [];
  for (const id of updateById.keys()) {
    if (!seenSegIds.has(id)) notFound.push(id);
  }

  return {
    catalog: { ...catalog, videos: nextVideos },
    applied,
    skippedAlreadyTagged,
    unknownTagsDropped,
    notFound,
  };
}
