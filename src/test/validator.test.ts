import { describe, it, expect } from "vitest";
import { validateAndSwap } from "@/server/pipeline/validator";
import type { MutablePick } from "@/server/pipeline/validator";

// ---------------------------------------------------------------------------
// Helpers (mirror Python test helpers)
// ---------------------------------------------------------------------------

function clip(id: string, main = "", secondary = "", third = "", duration = 30) {
  return { id, duration_sec: duration, tags: { main, secondary, third } };
}

function t(videoId: string, beatIdx: number, aStart: number, aEnd: number, videoStart = 0): MutablePick {
  return {
    video_id: videoId, beat_idx: beatIdx,
    audio_start: aStart, audio_end: aEnd,
    video_start: videoStart, video_end: videoStart + (aEnd - aStart),
    reason: "test",
  };
}

function segClip(id: string, segments: SegEntry[], duration = 30) {
  return { id, duration_sec: duration, segments };
}

interface SegEntry {
  id: string; start_sec: number; end_sec: number; tags?: string[]; description?: string;
}

function seg(segId: string, startSec: number, endSec: number, tags?: string[], description = ""): SegEntry {
  return { id: segId, start_sec: startSec, end_sec: endSec, tags: tags ?? [], description };
}

function tSeg(segId: string, beatIdx: number, aStart: number, aEnd: number, sceneIdx?: number): MutablePick {
  return {
    segment_id: segId, beat_idx: beatIdx,
    audio_start: aStart, audio_end: aEnd,
    scene_idx: sceneIdx,
    reason: "test",
  };
}

function segmentMapFrom(clips: ReturnType<typeof segClip>[]) {
  const sm: Record<string, { clip: ReturnType<typeof segClip>; segment: SegEntry }> = {};
  for (const c of clips) {
    for (const s of (c.segments ?? [])) {
      sm[s.id] = { clip: c, segment: s };
    }
  }
  return sm;
}

// ---------------------------------------------------------------------------
// Anti-repeat
// ---------------------------------------------------------------------------

describe("enforceAntiRepeat", () => {
  it("swaps 3rd occurrence of same clip to maintain count ≤ MAX_REPEATS", () => {
    const beats = [{ idx: 0, text: "rain", start: 0, end: 6 }];
    const catalog = [clip("A", "rain"), clip("B", "rain"), clip("C", "rain")];
    const videoMap = Object.fromEntries(catalog.map((c) => [c.id, c]));
    const timeline: MutablePick[] = [t("A", 0, 0, 2), t("A", 0, 2, 4), t("A", 0, 4, 6)];

    const out = validateAndSwap(timeline, { beats, videoMap });

    const ids = timeline.map((c) => c.video_id ?? "");
    for (const id of new Set(ids)) {
      expect(ids.filter((v) => v === id).length).toBeLessThanOrEqual(2);
    }
    for (let i = 1; i < ids.length; i++) {
      expect(ids[i]).not.toBe(ids[i - 1]);
    }
    expect(out.hard_violations_fixed.some((v) => String(v.issue).endsWith("repeat"))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Anti-consecutive
// ---------------------------------------------------------------------------

describe("enforceAntiConsecutive", () => {
  it("swaps the second of two consecutive identical picks", () => {
    const beats = [
      { idx: 0, text: "", start: 0, end: 5 },
      { idx: 1, text: "", start: 5, end: 10 },
    ];
    const catalog = [clip("A", "rain"), clip("B", "rain")];
    const videoMap = Object.fromEntries(catalog.map((c) => [c.id, c]));
    const timeline: MutablePick[] = [t("A", 0, 0, 5), t("A", 1, 5, 10)];

    const out = validateAndSwap(timeline, { beats, videoMap });

    expect(timeline[1].video_id).not.toBe("A");
    expect(out.hard_violations_fixed.some((v) => v.issue === "consecutive duplicate")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Min-clip merge
// ---------------------------------------------------------------------------

describe("mergeShortClips", () => {
  it("merges a 2s clip into its neighbor, extending audio range", () => {
    const beats = [
      { idx: 0, text: "rain", start: 0, end: 5 },
      { idx: 1, text: "rain", start: 5, end: 7 },
    ];
    const catalog = [clip("A", "rain"), clip("B", "rain")];
    const videoMap = Object.fromEntries(catalog.map((c) => [c.id, c]));
    // B is only 2s audio — below MIN_CLIP_DURATION (3.0)
    const timeline: MutablePick[] = [t("A", 0, 0, 5), t("B", 1, 5, 7)];

    validateAndSwap(timeline, { beats, videoMap });

    expect(timeline).toHaveLength(1);
    expect(timeline[0].video_id).toBe("A");
    expect(timeline[0].audio_start).toBe(0);
    expect(timeline[0].audio_end).toBe(7);
  });
});

// ---------------------------------------------------------------------------
// Clothing rule
// ---------------------------------------------------------------------------

describe("enforceClothingRule", () => {
  it("swaps a clothing-tagged clip on a non-wardrobe beat", () => {
    const beats = [{ idx: 0, text: "גשם בצפון", start: 0, end: 5 }];
    const catalog = [clip("CLOTHES", "coat", "winter"), clip("RAIN", "rain", "north")];
    const videoMap = Object.fromEntries(catalog.map((c) => [c.id, c]));
    const timeline: MutablePick[] = [t("CLOTHES", 0, 0, 5)];

    const out = validateAndSwap(timeline, { beats, videoMap });

    expect(timeline[0].video_id).not.toBe("CLOTHES");
    expect(out.hard_violations_fixed.some((v) => String(v.issue).includes("clothing"))).toBe(true);
  });

  it("keeps a clothing-tagged clip on a wardrobe beat", () => {
    const beats = [{ idx: 0, text: "מומלץ ללבוש מעיל", start: 0, end: 5 }];
    const catalog = [clip("CLOTHES", "coat"), clip("RAIN", "rain")];
    const videoMap = Object.fromEntries(catalog.map((c) => [c.id, c]));
    const timeline: MutablePick[] = [t("CLOTHES", 0, 0, 5)];

    const out = validateAndSwap(timeline, { beats, videoMap });

    expect(timeline[0].video_id).toBe("CLOTHES");
    expect(out.hard_violations_fixed.some((v) => String(v.issue).includes("clothing"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Coverage enforcement (segment-aware)
// ---------------------------------------------------------------------------

describe("enforceCoverage", () => {
  it("swaps short clip for longer same-theme candidate", () => {
    const short = segClip("SHORT", [seg("SHORT-s0", 0, 8, ["clouds"])], 8);
    const long_ = segClip("LONG", [seg("LONG-s0", 0, 20, ["clouds"])], 20);
    const sm = segmentMapFrom([short, long_]);
    const timeline: MutablePick[] = [{ ...tSeg("SHORT-s0", 0, 0, 12), scene_idx: 0 }];

    const out = validateAndSwap(timeline, {
      beats: [{ idx: 0, start: 0, end: 12, text: "clouds today" }],
      segmentMap: sm,
      videoMap: { SHORT: short, LONG: long_ },
    });

    expect(timeline[0].segment_id).toBe("LONG-s0");
    expect((timeline[0].video_end ?? 0) - (timeline[0].video_start ?? 0)).toBeCloseTo(12);
    const covFixes = out.hard_violations_fixed.filter((f) => f.issue === "coverage gap");
    expect(covFixes).toHaveLength(1);
    expect(covFixes[0].swapped_to).toBe("LONG-s0");
  });

  it("splits pick into two when no longer candidate exists", () => {
    const short = segClip("SHORT", [seg("SHORT-s0", 0, 8, ["clouds"])], 8);
    const other = segClip("OTHER", [seg("OTHER-s0", 0, 6, ["sea"])], 6);
    const sm = segmentMapFrom([short, other]);
    const timeline: MutablePick[] = [{ ...tSeg("SHORT-s0", 0, 0, 12), scene_idx: 0 }];

    validateAndSwap(timeline, {
      beats: [{ idx: 0, start: 0, end: 12, text: "cloudy day at sea" }],
      segmentMap: sm,
      videoMap: { SHORT: short, OTHER: other },
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0].segment_id).toBe("SHORT-s0");
    expect(timeline[0].audio_end).toBe(8);
    expect(timeline[1].segment_id).toBe("OTHER-s0");
    expect(timeline[1].audio_start).toBe(8);
    expect(timeline[1].audio_end).toBe(12);
    expect(timeline[1].scene_idx).toBe(0);
  });

  it("skips coverage check when gap is below tolerance (0.5s)", () => {
    const a = segClip("A", [seg("A-s0", 0, 4.7, ["clouds"])], 4.7);
    const sm = segmentMapFrom([a]);
    const timeline: MutablePick[] = [
      { ...tSeg("A-s0", 0, 0, 5.0), video_start: 0, video_end: 4.7, scene_idx: 0 },
    ];

    const out = validateAndSwap(timeline, {
      beats: [{ idx: 0, start: 0, end: 5, text: "x" }],
      segmentMap: sm,
      videoMap: { A: a },
    });

    const covFixes = out.hard_violations_fixed.filter((f) => f.issue === "coverage gap");
    expect(covFixes).toHaveLength(0);
    expect(timeline).toHaveLength(1);
  });
});
