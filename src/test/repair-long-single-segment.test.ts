import { describe, it, expect } from "vitest";
import type { Catalog, CatalogEntry, SegmentEntry } from "@/shared/types";
import {
  needsLoneSegmentSpanRepair,
  repairLoneSegmentSpan,
  listLoneSegmentRepairCandidates,
  applyLoneSegmentRepairsToCatalog,
  DEFAULT_REPAIR_SPLIT_ABOVE,
} from "@/server/catalog/repair-long-single-segment";
import { resegmentCatalog } from "@/server/catalog/resegment";

function seg(start: number, end: number, extras: Partial<SegmentEntry> = {}): SegmentEntry {
  return {
    start_sec: start,
    end_sec: end,
    description: extras.description ?? "",
    tags: extras.tags ?? [],
    ...(extras.confidence !== undefined ? { confidence: extras.confidence } : {}),
  };
}

function video(id: string, duration: number, segments: SegmentEntry[]): CatalogEntry {
  return {
    id,
    filename: `${id}.mp4`,
    description: "",
    duration_sec: duration,
    orientation: "H",
    source: "original",
    segments,
  };
}

function makeCatalog(videos: CatalogEntry[]): Catalog {
  return { videos, updated_at: "2026-05-13T00:00:00.000Z" };
}

describe("needsLoneSegmentSpanRepair", () => {
  it("is false when more than one segment", () => {
    const e = video("V1", 40, [seg(0, 20), seg(20, 40)]);
    expect(needsLoneSegmentSpanRepair(e, 40)).toBe(false);
  });

  it("is false when effective duration is at split threshold", () => {
    const e = video("V1", 29, [seg(0, 29)]);
    expect(needsLoneSegmentSpanRepair(e, 29)).toBe(false);
  });

  it("is true when span is exactly splitAbove but ffprobe is longer (IB012 class bug)", () => {
    const e = video("V1", 29.8, [seg(0, 29)]);
    expect(needsLoneSegmentSpanRepair(e, 29.8, { splitAbove: 29 })).toBe(true);
  });

  it("is true when span is short but catalog duration says long", () => {
    const e = video("V1", 45, [seg(0, 28)]);
    expect(needsLoneSegmentSpanRepair(e, 45)).toBe(true);
  });

  it("is false when lone segment already spans full clip above threshold", () => {
    const e = video("V1", 45, [seg(0, 45)]);
    expect(needsLoneSegmentSpanRepair(e, 45)).toBe(false);
  });
});

describe("repairLoneSegmentSpan", () => {
  it("widens to [0, effective] and preserves tags", () => {
    const e = video("V1", 29, [
      seg(0, 29, { tags: ["rain", "urban"], description: "x", confidence: 0.9 }),
    ]);
    const r = repairLoneSegmentSpan(e, 29.8);
    expect(r.segments).toHaveLength(1);
    expect(r.segments[0].start_sec).toBe(0);
    expect(r.segments[0].end_sec).toBe(29.8);
    expect(r.segments[0].tags).toEqual(["rain", "urban"]);
    expect(r.segments[0].description).toBe("x");
    expect(r.segments[0].confidence).toBe(0.9);
  });

  it("applies clip meta from probe when provided", () => {
    const e = video("V1", 29, [seg(0, 29)]);
    const r = repairLoneSegmentSpan(e, 30, { duration_sec: 30, orientation: "V" });
    expect(r.duration_sec).toBe(30);
    expect(r.orientation).toBe("V");
  });
});

describe("listLoneSegmentRepairCandidates + apply + resegment", () => {
  it("repair then resegment splits the long single segment", () => {
    const bad = makeCatalog([video("W001", 29.8, [seg(0, 29, { tags: ["sun"], description: "noon" })])]);
    const eff = (entry: CatalogEntry) => Math.max(entry.duration_sec ?? 0, 29.8);
    const cands = listLoneSegmentRepairCandidates(bad, eff, { splitAbove: DEFAULT_REPAIR_SPLIT_ABOVE });
    expect(cands).toHaveLength(1);

    const repaired = applyLoneSegmentRepairsToCatalog(bad, eff, undefined, { splitAbove: 29 });
    const { catalog: out, summary } = resegmentCatalog(repaired, { minWindow: 9, splitAbove: 29 });
    expect(summary.segmentsAfter).toBe(3);
    expect(out.videos[0].segments[0].tags).toEqual(["sun"]);
    expect(out.videos[0].segments[1].tags).toEqual([]);
    expect(out.videos[0].segments[2].tags).toEqual([]);
  });
});
