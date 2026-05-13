import { describe, it, expect } from "vitest";
import {
  CatalogSchema,
  type Catalog,
  type CatalogEntry,
  type SegmentEntry,
  type ParsedVideo,
} from "@/shared/types";
import {
  applyTagsToCatalog,
  selectEmptySegments,
} from "@/server/catalog/tagging";

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

function video(id: string, segments: SegmentEntry[]): CatalogEntry {
  return {
    id,
    filename: `${id}.mp4`,
    description: "",
    duration_sec: segments.reduce((m, s) => Math.max(m, s.end_sec), 0),
    orientation: "V",
    source: "original",
    tags: undefined,
    segments,
  };
}

function makeCatalog(videos: CatalogEntry[]): Catalog {
  return { videos, updated_at: "2026-05-13T00:00:00.000Z" };
}

function asParsed(catalog: Catalog): ParsedVideo[] {
  return catalog.videos.map((v) => ({
    ...v,
    path: `/tmp/${v.filename}`,
    availability: "local" as const,
    segments: (v.segments ?? []).map((s, i) => ({
      ...s,
      id: s.id || `${v.id}-s${i}`,
      tags: s.tags ?? [],
      description: s.description ?? "",
    })),
  }));
}

describe("selectEmptySegments", () => {
  it("returns only segments where both tags is empty AND description is empty", () => {
    const cat = makeCatalog([
      video("W001", [
        seg("W001-s0", 0, 10, { tags: ["clear_sky"], description: "noon" }),
        seg("W001-s1", 10, 20),
        seg("W001-s2", 20, 30, { tags: [], description: "  " }), // whitespace-only -> empty
        seg("W001-s3", 30, 40, { description: "described but no tags" }),
        seg("W001-s4", 40, 50, { tags: ["rain"] }), // tagged but no description
      ]),
    ]);
    const empties = selectEmptySegments(asParsed(cat));
    expect(empties.map((e) => e.segId)).toEqual(["W001-s1", "W001-s2"]);
    expect(empties[0]).toMatchObject({
      clipId: "W001",
      start_sec: 10,
      end_sec: 20,
    });
  });
});

describe("applyTagsToCatalog", () => {
  it("fills tags and description on empty segments only", () => {
    const cat = makeCatalog([
      video("W001", [
        seg("W001-s0", 0, 10),
        seg("W001-s1", 10, 20, { tags: ["rain"], description: "already" }),
      ]),
    ]);
    const result = applyTagsToCatalog(cat, [
      { segId: "W001-s0", tags: ["sun", "day", "urban"], description: "שמש בעיר" },
      { segId: "W001-s1", tags: ["snow"], description: "should not overwrite" },
    ]);
    expect(result.applied).toBe(1);
    expect(result.skippedAlreadyTagged).toBe(1);
    expect(result.catalog.videos[0].segments[0].tags).toEqual(["sun", "day", "urban"]);
    expect(result.catalog.videos[0].segments[0].description).toBe("שמש בעיר");
    expect(result.catalog.videos[0].segments[1].tags).toEqual(["rain"]);
    expect(result.catalog.videos[0].segments[1].description).toBe("already");
  });

  it("silently drops tags not in TAG_VOCAB", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 10)])]);
    const result = applyTagsToCatalog(cat, [
      {
        segId: "W001-s0",
        tags: ["sun", "totally_made_up", "day", "another_invented_one", ""],
        description: "x",
      },
    ]);
    expect(result.applied).toBe(1);
    expect(result.unknownTagsDropped).toBe(2);
    expect(result.catalog.videos[0].segments[0].tags).toEqual(["sun", "day"]);
  });

  it("de-duplicates repeated tags while preserving first-seen order", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 10)])]);
    const result = applyTagsToCatalog(cat, [
      {
        segId: "W001-s0",
        tags: ["sun", "day", "sun", "urban", "day"],
        description: "x",
      },
    ]);
    expect(result.catalog.videos[0].segments[0].tags).toEqual(["sun", "day", "urban"]);
  });

  it("treats an empty update (tags=[] AND description='') as a no-op uninformative frame", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 10)])]);
    const result = applyTagsToCatalog(cat, [
      { segId: "W001-s0", tags: [], description: "" },
    ]);
    expect(result.applied).toBe(0);
    expect(result.catalog.videos[0].segments[0].tags).toEqual([]);
    expect(result.catalog.videos[0].segments[0].description).toBe("");
  });

  it("never modifies clip-level fields", () => {
    const original = makeCatalog([
      {
        ...video("W001", [seg("W001-s0", 0, 10)]),
        description: "clip description preserved",
        duration_sec: 42,
        orientation: "H",
        source: "getty",
        added_at: "2026-01-01T00:00:00Z",
        original_filename: "raw.mov",
        remote: { key: "tenants/default/videos/W001/W001.mp4", status: "local" },
        tags: { main: "rain", secondary: "", third: "" },
      },
    ]);
    const result = applyTagsToCatalog(original, [
      { segId: "W001-s0", tags: ["sun"], description: "x" },
    ]);
    const v = result.catalog.videos[0];
    expect(v.id).toBe("W001");
    expect(v.filename).toBe("W001.mp4");
    expect(v.description).toBe("clip description preserved");
    expect(v.duration_sec).toBe(42);
    expect(v.orientation).toBe("H");
    expect(v.source).toBe("getty");
    expect(v.added_at).toBe("2026-01-01T00:00:00Z");
    expect(v.original_filename).toBe("raw.mov");
    expect(v.remote).toEqual({ key: "tenants/default/videos/W001/W001.mp4", status: "local" });
    expect(v.tags).toEqual({ main: "rain", secondary: "", third: "" });
  });

  it("never modifies untouched segment fields (start_sec, end_sec, confidence)", () => {
    const cat = makeCatalog([
      video("W001", [seg("W001-s0", 1.25, 11.75, { confidence: 0.91 })]),
    ]);
    const result = applyTagsToCatalog(cat, [
      { segId: "W001-s0", tags: ["sun"], description: "x" },
    ]);
    const s = result.catalog.videos[0].segments[0];
    expect(s.id).toBe("W001-s0");
    expect(s.start_sec).toBe(1.25);
    expect(s.end_sec).toBe(11.75);
    expect(s.confidence).toBe(0.91);
  });

  it("records segIds that don't match any segment in `notFound`", () => {
    const cat = makeCatalog([video("W001", [seg("W001-s0", 0, 10)])]);
    const result = applyTagsToCatalog(cat, [
      { segId: "W001-s0", tags: ["sun"], description: "x" },
      { segId: "GHOST-s9", tags: ["rain"], description: "y" },
    ]);
    expect(result.applied).toBe(1);
    expect(result.notFound).toEqual(["GHOST-s9"]);
  });

  it("produces a catalog that still passes CatalogSchema.parse", () => {
    const cat = makeCatalog([
      video("W001", [seg("W001-s0", 0, 10), seg("W001-s1", 10, 20)]),
    ]);
    const result = applyTagsToCatalog(cat, [
      { segId: "W001-s0", tags: ["sun", "day"], description: "א" },
      { segId: "W001-s1", tags: ["clouds"], description: "ב" },
    ]);
    expect(() => CatalogSchema.parse(result.catalog)).not.toThrow();
  });
});
