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
  id: string; start_sec: number; end_sec: number; tags?: string[]; description?: string; concepts?: any;
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
// Same clip reuse (parent video_id / clip_id)
// ---------------------------------------------------------------------------

describe("enforceAntiClipReuse", () => {
  it("swaps the later pick when two segments on the same file are too similar in tags/description", () => {
    const dup = segClip(
      "DUP",
      [
        seg("DUP-s0", 0, 5, ["rain", "north"], "גשם בצפון"),
        seg("DUP-s1", 5, 10, ["rain", "north"], "גשם כבד בגליל"),
      ],
      30
    );
    const other = segClip("OTH", [seg("OTH-s0", 0, 20, ["rain", "sea"])], 20);
    const sm = segmentMapFrom([dup, other]);
    const beats = [
      { idx: 0, text: "rain in the north", start: 0, end: 5 },
      { idx: 1, text: "rain and sea in the north", start: 5, end: 10 },
    ];
    const timeline: MutablePick[] = [
      { ...tSeg("DUP-s0", 0, 0, 5), scene_idx: 0 },
      { ...tSeg("DUP-s1", 1, 5, 10), scene_idx: 1 },
    ];

    const out = validateAndSwap(timeline, { beats, segmentMap: sm, videoMap: { DUP: dup, OTH: other } });

    expect(timeline[0].video_id).toBe("DUP");
    expect(timeline[1].video_id).toBe("OTH");
    expect(timeline[1].segment_id).toBe("OTH-s0");
    expect(out.hard_violations_fixed.some((v) => v.issue === "same clip reuse" && v.fixed === true)).toBe(true);
  });

  it("keeps two picks from the same file when segment tags describe clearly different concepts", () => {
    const dup = segClip(
      "DUP",
      [
        seg("DUP-s0", 0, 5, ["urban", "storm"], "עיר בסערה"),
        seg("DUP-s1", 5, 10, ["sea", "calm"], "ים שקט בבוקר"),
      ],
      30
    );
    const sm = segmentMapFrom([dup]);
    const beats = [
      { idx: 0, text: "סערה במרכז", start: 0, end: 5 },
      { idx: 1, text: "ים שקט", start: 5, end: 10 },
    ];
    const timeline: MutablePick[] = [
      { ...tSeg("DUP-s0", 0, 0, 5), scene_idx: 0 },
      { ...tSeg("DUP-s1", 1, 5, 10), scene_idx: 1 },
    ];

    validateAndSwap(timeline, { beats, segmentMap: sm, videoMap: { DUP: dup } });

    expect(timeline[0].video_id).toBe("DUP");
    expect(timeline[1].video_id).toBe("DUP");
    expect(timeline[0].segment_id).toBe("DUP-s0");
    expect(timeline[1].segment_id).toBe("DUP-s1");
  });

  it("swaps the third pick when the same parent clip appears more than twice", () => {
    const dup = segClip(
      "DUP",
      [
        seg("DUP-s0", 0, 5, ["urban", "storm"], "עיר בסערה"),
        seg("DUP-s1", 5, 10, ["sea", "calm"], "ים שקט"),
      ],
      30
    );
    const other = segClip("OTH", [seg("OTH-s0", 0, 20, ["weather", "urban", "night"])], 20);
    const sm = segmentMapFrom([dup, other]);
    const beats = [
      { idx: 0, text: "urban weather", start: 0, end: 3 },
      { idx: 1, text: "urban weather", start: 3, end: 6 },
      { idx: 2, text: "urban weather", start: 6, end: 9 },
    ];
    const timeline: MutablePick[] = [
      { ...tSeg("DUP-s0", 0, 0, 3), scene_idx: 0 },
      { ...tSeg("DUP-s1", 1, 3, 6), scene_idx: 0 },
      { ...tSeg("DUP-s0", 2, 6, 9), scene_idx: 1 },
    ];

    validateAndSwap(timeline, { beats, segmentMap: sm, videoMap: { DUP: dup, OTH: other } });

    const dupCount = timeline.filter((c) => c.video_id === "DUP").length;
    expect(dupCount).toBe(2);
    expect(timeline.some((c) => c.video_id === "OTH")).toBe(true);
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
  it("swaps short clip for a materially-better longer candidate", () => {
    // LONG has strictly more topical overlap than SHORT — clearly beats the
    // 25% swap-margin gate, so wholesale swap fires.
    const short = segClip("SHORT", [seg("SHORT-s0", 0, 8, ["clouds"])], 8);
    const long_ = segClip(
      "LONG",
      [seg("LONG-s0", 0, 20, ["clouds", "blue", "sky", "forecast"])],
      20,
    );
    const sm = segmentMapFrom([short, long_]);
    const timeline: MutablePick[] = [{ ...tSeg("SHORT-s0", 0, 0, 12), scene_idx: 0 }];

    const out = validateAndSwap(timeline, {
      beats: [{ idx: 0, start: 0, end: 12, text: "blue clouds sky forecast today" }],
      segmentMap: sm,
      videoMap: { SHORT: short, LONG: long_ },
    });

    expect(timeline[0].segment_id).toBe("LONG-s0");
    expect((timeline[0].video_end ?? 0) - (timeline[0].video_start ?? 0)).toBeCloseTo(12);
    const covFixes = out.hard_violations_fixed.filter((f) => f.issue === "coverage gap");
    expect(covFixes).toHaveLength(1);
    expect(covFixes[0].swapped_to).toBe("LONG-s0");
  });

  it("prefers split over swap when candidate is not materially better", () => {
    // SHORT and LONG have identical tags → BM25 scores tie → swap margin
    // (>=25%) is not met. Validator must fall through to Strategy 2 (split):
    // keep SHORT-s0 as the head and add LONG-s0 as a residual covering the
    // 4-second tail. Discards the upstream LLM's narrative intent only when
    // the new candidate is meaningfully better.
    const short = segClip("SHORT", [seg("SHORT-s0", 0, 8, ["clouds", "blue"])], 8);
    const long_ = segClip("LONG", [seg("LONG-s0", 0, 20, ["clouds", "blue"])], 20);
    const sm = segmentMapFrom([short, long_]);
    const timeline: MutablePick[] = [{ ...tSeg("SHORT-s0", 0, 0, 12), scene_idx: 0 }];

    validateAndSwap(timeline, {
      beats: [{ idx: 0, start: 0, end: 12, text: "blue clouds forecast today" }],
      segmentMap: sm,
      videoMap: { SHORT: short, LONG: long_ },
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[0].segment_id).toBe("SHORT-s0");
    expect(timeline[0].audio_end).toBeCloseTo(8);
    expect(timeline[1].segment_id).toBe("LONG-s0");
    expect(timeline[1].audio_start).toBeCloseTo(8);
    expect(timeline[1].audio_end).toBeCloseTo(12);
  });

  it("splits pick into two when no longer candidate exists", () => {
    const short = segClip("SHORT", [seg("SHORT-s0", 0, 8, ["clouds"])], 8);
    const other = segClip("OTHER", [seg("OTHER-s0", 0, 6, ["sea", "day"])], 6);
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

// ---------------------------------------------------------------------------
// Semantic fit
// ---------------------------------------------------------------------------

describe("enforceSemanticFit", () => {
  it("swaps an autumn/winter concept away from a heatwave scene", () => {
    const bad = segClip(
      "BAD",
      [
        {
          ...seg("BAD-s0", 0, 10, ["יום", "טבע"], "עלי שלכת על שביל"),
          concepts: {
            weather: ["מעונן"],
            season_mood: ["סתווי"],
            visual_role: ["רקע כללי", "טבע"],
            scene_fit: ["טמפרטורות"],
            avoid_for: ["שרב"],
          },
        } as any,
      ],
      10,
    );
    const good = segClip(
      "GOOD",
      [
        {
          ...seg("GOOD-s0", 0, 10, ["שמש", "יום", "חם", "טבע"], "שמש חזקה מעל נוף יבש"),
          concepts: {
            weather: ["חם", "בהיר"],
            season_mood: ["קיצי"],
            visual_role: ["עומס חום", "טבע"],
            scene_fit: ["שרב", "קרינת שמש"],
            avoid_for: ["חורף"],
          },
        } as any,
      ],
      10,
    );
    const sm = segmentMapFrom([bad, good] as any);
    const timeline: MutablePick[] = [{ ...tSeg("BAD-s0", 0, 0, 5), scene_idx: 0 }];

    const out = validateAndSwap(timeline, {
      beats: [{ idx: 0, text: "שרב כבד ועומס חום", start: 0, end: 5 }],
      segmentMap: sm as any,
      videoMap: { BAD: bad, GOOD: good } as any,
    });

    expect(timeline[0].segment_id).toBe("GOOD-s0");
    expect(out.hard_violations_fixed.some((v) => v.issue === "semantic mismatch")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Scene gap fill
// ---------------------------------------------------------------------------

describe("fillSceneGaps", () => {
  it("does not auto-fill an empty picker result unless explicitly allowed", () => {
    const heat = segClip("HEAT", [
      seg("HEAT-s0", 0, 8, ["שמש", "חם"], "שמש חזקה מעל אזור יבש"),
    ]);
    const timeline: MutablePick[] = [];

    const out = validateAndSwap(timeline, {
      segmentMap: segmentMapFrom([heat]),
      videoMap: { HEAT: heat },
      scenes: [{
        idx: 0,
        start_sec: 0,
        end_sec: 8,
        narration: "שרב ועומס חום",
        keywords: ["שרב"],
      }],
    });

    expect(timeline).toHaveLength(0);
    expect(out.gap_filled).toBeUndefined();
    expect(out.warnings.some((w) => w.issue === "scene has no pick")).toBe(true);
  });

  it("fills only when allowed and there is positive Hebrew concept overlap", () => {
    const heat = segClip("HEAT", [
      seg("HEAT-s0", 0, 8, ["שמש", "חם"], "שמש חזקה מעל אזור יבש"),
    ]);
    const autumn = segClip("AUTUMN", [
      seg("AUTUMN-s0", 0, 8, ["טבע"], "עלי שלכת בשביל"),
    ]);
    const timeline: MutablePick[] = [{ ...tSeg("HEAT-s0", 0, 0, 8), scene_idx: 0 }];

    const out = validateAndSwap(timeline, {
      segmentMap: segmentMapFrom([heat, autumn]),
      videoMap: { HEAT: heat, AUTUMN: autumn },
      allowSceneGapFill: true,
      scenes: [
        {
          idx: 0,
          start_sec: 0,
          end_sec: 8,
          narration: "שרב ועומס חום",
          keywords: ["שרב"],
        },
        {
          idx: 1,
          start_sec: 8,
          end_sec: 16,
          narration: "קרינת שמש גבוהה חם",
          keywords: ["שמש"],
        },
      ],
    });

    expect(timeline).toHaveLength(2);
    expect(timeline[1].segment_id).toBe("HEAT-s0");
    expect(timeline[1].fallback_reason).toContain("נבחר כמילוי אוטומטי");
    expect(out.gap_filled).toHaveLength(1);
    expect(out.score).toBeLessThan(100);
  });

  it("does not fill with zero-overlap catalog order candidates", () => {
    const autumn = segClip("AUTUMN", [
      seg("AUTUMN-s0", 0, 8, ["טבע"], "עלי שלכת בשביל"),
    ]);
    const timeline: MutablePick[] = [];

    const out = validateAndSwap(timeline, {
      segmentMap: segmentMapFrom([autumn]),
      videoMap: { AUTUMN: autumn },
      allowSceneGapFill: true,
      scenes: [{
        idx: 0,
        start_sec: 0,
        end_sec: 8,
        narration: "קרינת שמש גבוהה",
        keywords: ["שמש"],
      }],
    });

    expect(timeline).toHaveLength(0);
    expect(out.gap_filled?.[0]).toMatchObject({ fixed: false });
  });
});

describe("timeline render order", () => {
  it("sorts picks by audio_start after validation (matches concat / Plan order)", () => {
    const c = segClip(
      "CLIP",
      [
        seg("CLIP-s0", 0, 15, ["חורפי"], "שקדייה פרחים"),
        seg("CLIP-s1", 15, 30, ["ים"], "גלים"),
      ],
      30,
    );
    const sm = segmentMapFrom([c]);
    const beats = [
      { idx: 0, text: "קריר", start: 0, end: 5 },
      { idx: 1, text: "ים", start: 5, end: 10 },
    ];
    const scenes = [{ idx: 0, start_sec: 0, end_sec: 10, narration: "מזג", keywords: [] as string[] }];
    const timeline: MutablePick[] = [
      { ...tSeg("CLIP-s1", 1, 5, 10, 0), scene_idx: 0 },
      { ...tSeg("CLIP-s0", 0, 0, 5, 0), scene_idx: 0 },
    ];

    validateAndSwap(timeline, {
      beats,
      segmentMap: sm,
      videoMap: { CLIP: c },
      scenes,
      allowSceneGapFill: true,
    });

    expect(timeline.map((p) => p.segment_id)).toEqual(["CLIP-s0", "CLIP-s1"]);
    expect(timeline[0]!.audio_start).toBe(0);
    expect(timeline[1]!.audio_start).toBe(5);
  });

  describe("quality categorisation (advisory; not based on score)", () => {
    it("returns quality='ship' for a clean timeline with no kept hard violations", () => {
      const c = clip("A", "weather");
      const beats = [{ idx: 0, start: 0, end: 5, text: "מזג אוויר" }];
      const timeline: MutablePick[] = [t("A", 0, 0, 5)];
      const out = validateAndSwap(timeline, { beats, videoMap: { A: c } });
      expect(out.quality).toBe("ship");
      expect(out.hard_violations_kept).toHaveLength(0);
    });
  });
});
