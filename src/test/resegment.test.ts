import { describe, it, expect } from "vitest";
import type { Catalog, CatalogEntry, SegmentEntry } from "@/shared/types";
import { resegmentCatalog } from "@/server/catalog/resegment";

function seg(
  id: string,
  start: number,
  end: number,
  extras: Partial<SegmentEntry> = {},
): SegmentEntry {
  return {
    id,
    start_sec: start,
    end_sec: end,
    description: extras.description ?? "",
    tags: extras.tags ?? [],
    ...(extras.confidence !== undefined ? { confidence: extras.confidence } : {}),
  };
}

function video(
  id: string,
  segments: SegmentEntry[],
  durationSec = segments.reduce((m, s) => Math.max(m, s.end_sec), 0),
): CatalogEntry {
  return {
    id,
    filename: `${id}.mp4`,
    description: "",
    duration_sec: durationSec,
    orientation: "V",
    source: "original",
    tags: undefined,
    segments,
  };
}

function makeCatalog(videos: CatalogEntry[]): Catalog {
  return { videos, updated_at: "2026-05-13T00:00:00.000Z" };
}

describe("resegmentCatalog", () => {
  it("leaves a single 29s segment untouched (boundary)", () => {
    const cat = makeCatalog([
      video("W001", [seg("W001-s0", 0, 29, { tags: ["clear_sky"], description: "noon" })]),
    ]);
    const { catalog, changes, summary } = resegmentCatalog(cat);
    expect(catalog.videos[0].segments).toEqual([
      seg("W001-s0", 0, 29, { tags: ["clear_sky"], description: "noon" }),
    ]);
    expect(changes[0]).toMatchObject({ videoId: "W001", oldCount: 1, newCount: 1 });
    expect(summary).toMatchObject({ videosChanged: 0, segmentsBefore: 1, segmentsAfter: 1 });
  });

  it("splits 30s into 3x10s windows", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 30)])]);
    const { catalog } = resegmentCatalog(cat);
    const segments = catalog.videos[0].segments;
    expect(segments).toHaveLength(3);
    expect(segments.map((s) => [s.start_sec, s.end_sec])).toEqual([
      [0, 10],
      [10, 20],
      [20, 30],
    ]);
    expect(segments.map((s) => s.id)).toEqual(["W001-s0", "W001-s1", "W001-s2"]);
  });

  it("splits a long 389s segment into N windows that are all >= 9s and identical length, ending exactly at the original end", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 389)])]);
    const { catalog } = resegmentCatalog(cat);
    const segments = catalog.videos[0].segments;
    const n = Math.floor(389 / 9);
    expect(n).toBe(43);
    expect(segments).toHaveLength(n);
    const durations = segments.map((s) => +(s.end_sec - s.start_sec).toFixed(6));
    for (const d of durations) expect(d).toBeGreaterThanOrEqual(9);
    // First N-1 windows are equal-length to the resolution we round to
    // (3 decimals); last window absorbs the float remainder so the
    // end-time pins to the original end.
    const first = durations[0];
    for (let i = 1; i < durations.length - 1; i++) {
      expect(durations[i]).toBeCloseTo(first, 2);
    }
    expect(segments[0].start_sec).toBe(0);
    expect(segments[segments.length - 1].end_sec).toBe(389);
  });

  it("inherits tags/description/confidence only on the first new window; the rest are empty", () => {
    const cat = makeCatalog([
      video("W001", [
        seg("W001-s0", 0, 60, {
          tags: ["clear_sky", "day"],
          description: "afternoon establishing shot",
          confidence: 0.87,
        }),
      ]),
    ]);
    const { catalog } = resegmentCatalog(cat);
    const segments = catalog.videos[0].segments;
    expect(segments).toHaveLength(6);

    expect(segments[0].tags).toEqual(["clear_sky", "day"]);
    expect(segments[0].description).toBe("afternoon establishing shot");
    expect(segments[0].confidence).toBe(0.87);

    for (let i = 1; i < segments.length; i++) {
      expect(segments[i].tags).toEqual([]);
      expect(segments[i].description).toBe("");
      expect(segments[i].confidence).toBeUndefined();
    }
  });

  it("rebuilds ids as ${videoId}-s0..N-1 even when input ids are missing or inconsistent", () => {
    const cat = makeCatalog([
      video("W001", [
        // duration 35s -> floor(35/9)=3 windows
        seg("legacy-id-A", 0, 35, { tags: ["rain"] }),
      ]),
    ]);
    const { catalog } = resegmentCatalog(cat);
    expect(catalog.videos[0].segments.map((s) => s.id)).toEqual([
      "W001-s0",
      "W001-s1",
      "W001-s2",
    ]);
  });

  it("processes multiple segments in one video, splitting only those above the threshold", () => {
    const cat = makeCatalog([
      video("W001", [
        seg("W001-s0", 0, 10, { tags: ["a"] }),
        seg("W001-s1", 10, 50, { tags: ["b"] }), // 40s -> 4 windows of 10s
        seg("W001-s2", 50, 75, { tags: ["c"] }), // 25s -> untouched
      ]),
    ]);
    const { catalog, changes } = resegmentCatalog(cat);
    const segments = catalog.videos[0].segments;
    // 1 + 4 + 1 = 6 windows total
    expect(segments).toHaveLength(6);
    expect(changes[0].splitsBySegment).toEqual([1, 4, 1]);

    // First sub-window of the original middle segment inherits ["b"]; the
    // sub-windows after it must have empty tags.
    expect(segments[1].tags).toEqual(["b"]);
    expect(segments[2].tags).toEqual([]);
    expect(segments[3].tags).toEqual([]);
    expect(segments[4].tags).toEqual([]);

    // Untouched first and last segments keep their original tags.
    expect(segments[0].tags).toEqual(["a"]);
    expect(segments[5].tags).toEqual(["c"]);
  });

  it("respects custom minWindow / splitAbove options", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 30)])]);
    const { catalog } = resegmentCatalog(cat, { minWindow: 15, splitAbove: 20 });
    // 30 / 15 = 2 windows of 15s
    const segments = catalog.videos[0].segments;
    expect(segments).toHaveLength(2);
    expect(segments.map((s) => [s.start_sec, s.end_sec])).toEqual([
      [0, 15],
      [15, 30],
    ]);
  });

  it("rejects non-positive options", () => {
    const cat = makeCatalog([]);
    expect(() => resegmentCatalog(cat, { minWindow: 0 })).toThrow();
    expect(() => resegmentCatalog(cat, { splitAbove: -1 })).toThrow();
  });
});
