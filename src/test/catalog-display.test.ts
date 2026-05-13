import { describe, expect, it } from "vitest";
import type { ParsedVideo } from "@/shared/types";
import {
  catalogDurationLabel,
  catalogSegmentPreviews,
  catalogSegmentStats,
  catalogVideoTitle,
  matchesCatalogSearch,
  segmentListStats,
  topCatalogTags,
} from "@/client/lib/catalog-display";

function video(patch: Partial<ParsedVideo> = {}): ParsedVideo {
  return {
    id: "IB001",
    filename: "IB001_clear-sky.mp4",
    path: "/tmp/IB001_clear-sky.mp4",
    duration_sec: 12,
    orientation: "H",
    description: "",
    source: "original",
    availability: "local",
    segments: [
      {
        id: "IB001-s0",
        start_sec: 0,
        end_sec: 12,
        description: "שמש מעל החוף",
        tags: ["sun", "day", "sea"],
      },
    ],
    ...patch,
  };
}

describe("catalog display helpers", () => {
  it("prefers Hebrew clip description as the visible title", () => {
    expect(catalogVideoTitle(video({ description: "גשם ברחוב עירוני" }))).toBe("גשם ברחוב עירוני");
  });

  it("falls back to the first segment description before filename", () => {
    expect(catalogVideoTitle(video())).toBe("שמש מעל החוף");
  });

  it("searches Hebrew labels, segment descriptions, filenames, and raw ids", () => {
    const v = video();

    expect(matchesCatalogSearch(v, "חוף")).toBe(true);
    expect(matchesCatalogSearch(v, "שמש")).toBe(true);
    expect(matchesCatalogSearch(v, "clear-sky")).toBe(true);
    expect(matchesCatalogSearch(v, "IB001-s0")).toBe(true);
    expect(matchesCatalogSearch(v, "שלג")).toBe(false);
  });

  it("sorts top tags by frequency and returns raw values for persistence", () => {
    const v = video({
      segments: [
        { id: "a", start_sec: 0, end_sec: 4, description: "", tags: ["sun", "day"] },
        { id: "b", start_sec: 4, end_sec: 8, description: "", tags: ["sun", "sea"] },
      ],
    });

    expect(topCatalogTags(v, 2)).toEqual(["sun", "day"]);
  });

  it("formats durations in Hebrew UI copy", () => {
    expect(catalogDurationLabel(8.4)).toBe("8 שנ׳");
    expect(catalogDurationLabel(0)).toBe("");
  });

  it("summarizes segment coverage for catalog UI", () => {
    const v = video({
      segments: [
        { id: "a", start_sec: 0, end_sec: 4, description: "גשם", tags: ["rain"] },
        { id: "b", start_sec: 4, end_sec: 8, description: "עננים", tags: [] },
        { id: "c", start_sec: 8, end_sec: 12, description: "", tags: [] },
      ],
    });

    expect(catalogSegmentStats(v)).toEqual({ total: 3, tagged: 1, described: 2, empty: 1 });
    expect(segmentListStats(v.segments)).toEqual({ total: 3, tagged: 1, described: 2, empty: 1 });
  });

  it("promotes matching segment previews before generic clip previews", () => {
    const v = video({
      segments: [
        { id: "a", start_sec: 0, end_sec: 4, description: "שמש מעל החוף", tags: ["sun"] },
        { id: "b", start_sec: 4, end_sec: 8, description: "גשם כבד ברחוב", tags: ["rain"] },
      ],
    });

    expect(catalogSegmentPreviews(v, "גשם", 1)).toEqual([
      {
        id: "b",
        description: "גשם כבד ברחוב",
        timeRange: "00:04-00:08",
        tags: ["rain"],
      },
    ]);
  });
});
