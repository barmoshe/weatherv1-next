import { describe, it, expect } from "vitest";

import { validateAndSwap } from "@/server/pipeline/validator";
import type { MutablePick } from "@/server/pipeline/validator";

// Regression coverage for the "סטודיו / 6c49bb99" failure: scene 5 narration
// is "the heat wave is ending, return to normal weather" with mood=calm. The
// picker chose a calm winter rain segment (W034-s0, 6.06s) — semantically
// right but 2s shorter than the 8.04s scene. The validator's
// enforceCoverage Strategy 1 swapped it for a flood scene (W005-s0, 28s)
// because tag overlap was 3 and length was sufficient — even though "flood"
// is the tonal opposite of "calm temperature drop".
//
// After the BM25 + mood + swap-margin changes (`SWAP_MARGIN_FRACTION`,
// `MOOD_INCOMPATIBLE`), the validator must either:
//   1. keep W034-s0 and add a residual pick (Strategy 2 fires), or
//   2. swap to a different mood-compatible candidate.
// In either case the flood segment (W005-s0) must NOT end up in the
// scene-5 timeline slot.

interface SegEntry {
  id: string;
  start_sec: number;
  end_sec: number;
  tags?: string[];
  description?: string;
}

function seg(id: string, startSec: number, endSec: number, tags: string[], description: string): SegEntry {
  return { id, start_sec: startSec, end_sec: endSec, tags, description };
}

function segClip(id: string, segments: SegEntry[], duration: number) {
  return { id, duration_sec: duration, segments };
}

function segmentMapFrom(clips: ReturnType<typeof segClip>[]) {
  const sm: Record<string, { clip: ReturnType<typeof segClip>; segment: SegEntry }> = {};
  for (const c of clips) {
    for (const s of c.segments ?? []) sm[s.id] = { clip: c, segment: s };
  }
  return sm;
}

describe("enforceCoverage — scene-5 / 6c49bb99 (W034 vs W005)", () => {
  // Realistic catalog excerpt from the live failure. A few mood-neutral
  // alternative clips are included so the validator has somewhere to land
  // when neither W034 nor W005 wins.
  const catalog = [
    segClip(
      "W034",
      [
        seg(
          "W034-s0",
          0,
          6.06,
          ["גשם", "יום", "חורף", "עירוני", "רגוע"],
          "השתקפות בניינים בשלולית גשם על מדרכה רטובה ביום חורפי.",
        ),
      ],
      6.06,
    ),
    segClip(
      "W005",
      [
        seg(
          "W005-s0",
          0,
          28,
          ["מעונן", "יום", "חורף", "גשם", "חם", "שמש", "קיץ", "ים"],
          "שיטפון של מים חומים זורם בנחל מדברי לאחר גשם.",
        ),
      ],
      28,
    ),
    segClip(
      "IB200",
      [
        seg(
          "IB200-s0",
          0,
          12,
          ["שמיים בהירים", "יום", "רגוע", "טבע"],
          "נוף פתוח עם שמיים בהירים ועננים בודדים ביום רגיל.",
        ),
      ],
      12,
    ),
    segClip(
      "IB201",
      [
        seg(
          "IB201-s0",
          0,
          9,
          ["עיר", "יום", "רגוע", "אביבי"],
          "מבט אל עיר חופית במזג אוויר נעים ורגיל לעונה.",
        ),
      ],
      9,
    ),
  ];

  const videoMap = Object.fromEntries(catalog.map((c) => [c.id, c]));
  const segmentMap = segmentMapFrom(catalog);

  const sceneFive = {
    idx: 4,
    start_sec: 19,
    end_sec: 27.04,
    title_he: "ירידה בטמפרטורות",
    narration:
      "ביום שלישי כבר נתחיל להרגיש ירידה בטמפרטורות. ברביעי, גל החום מסתיים, ונחזור למזג האוויר רגיל העונה.",
    keywords: ["ירידה", "טמפרטורה", "מזג אוויר רגיל", "סיום"],
    mood: "calm",
    kind: "prose",
    heterogeneous: false,
  };

  function buildTimeline(): MutablePick[] {
    // Mirrors what the picker handed in: picked W034-s0 covering the full
    // 8.04s audio range from its 0..6.06 source — i.e. 2s short.
    return [
      {
        scene_idx: 4,
        segment_id: "W034-s0",
        video_id: "W034",
        audio_start: 19,
        audio_end: 27.04,
        video_start: 0,
        video_end: 6.06,
        reason: "calm urban winter rain — matches mood",
        picker_reason: "calm urban winter rain — matches mood",
      },
    ];
  }

  it("transitional narration (heat ending) does NOT reject mood-compatible cool clips", () => {
    // The scene narration says "the heat wave is ending, return to normal".
    // inferConcepts would naively tag it as weather=["שרב"] from the literal
    // heat words, and most calm/cool clips carry `avoid_for: ["שרב"]`. If the
    // structural floor fired on transitional narrations it would reject the
    // very candidates that should win. The polarity check must disengage the
    // floor so W034 (calm winter rain — avoid_for:["שרב"]) stays viable.
    const transitionalCatalog = [
      segClip(
        "W034",
        [
          seg(
            "W034-s0",
            0,
            9,
            ["גשם", "יום", "חורף", "עירוני", "רגוע"],
            "השתקפות בניינים בשלולית גשם על מדרכה רטובה ביום חורפי.",
          ),
        ],
        9,
      ),
    ];
    (segmentMapFrom(transitionalCatalog)["W034-s0"].segment as { concepts?: unknown }).concepts = {
      weather: ["גשם"],
      season_mood: ["חורפי"],
      visual_role: ["עיר"],
      scene_fit: ["טמפרטורות"],
      avoid_for: ["שרב"],
    };
    const transitionalSegmentMap = segmentMapFrom(transitionalCatalog);
    // Re-apply concepts (segmentMapFrom returns fresh objects each call).
    (transitionalSegmentMap["W034-s0"].segment as { concepts?: unknown }).concepts = {
      weather: ["גשם"],
      season_mood: ["חורפי"],
      visual_role: ["עיר"],
      scene_fit: ["טמפרטורות"],
      avoid_for: ["שרב"],
    };
    const transitionalVideoMap = Object.fromEntries(transitionalCatalog.map((c) => [c.id, c]));

    const transitionalScene = {
      idx: 0,
      start_sec: 0,
      end_sec: 8,
      title_he: "ירידה בטמפרטורות",
      narration:
        "ביום שלישי כבר נתחיל להרגיש ירידה בטמפרטורות. ברביעי, גל החום מסתיים, ונחזור למזג האוויר רגיל העונה.",
      keywords: ["ירידה", "טמפרטורה", "מזג אוויר רגיל"],
      mood: "calm",
      kind: "prose",
      heterogeneous: false,
    };

    const timeline: MutablePick[] = [
      {
        scene_idx: 0,
        segment_id: "W034-s0",
        video_id: "W034",
        audio_start: 0,
        audio_end: 8,
        video_start: 0,
        video_end: 8,
        reason: "calm winter rain — matches the calm transition",
      },
    ];

    validateAndSwap(timeline, {
      videoMap: transitionalVideoMap,
      segmentMap: transitionalSegmentMap,
      scenes: [transitionalScene],
    });

    // W034 must still be the pick — the structural floor was correctly
    // skipped because the narration is transitional.
    const ids = timeline.filter((c) => c.scene_idx === 0).map((c) => c.segment_id ?? "");
    expect(ids).toContain("W034-s0");
  });

  it("does not swap to the flood segment W005-s0", () => {
    const timeline = buildTimeline();
    const result = validateAndSwap(timeline, {
      videoMap,
      segmentMap,
      scenes: [sceneFive],
    });

    const sceneFiveIds = timeline
      .filter((c) => c.scene_idx === 4)
      .map((c) => c.segment_id ?? "");

    expect(sceneFiveIds).not.toContain("W005-s0");

    // Sanity: validator should leave at least one pick covering scene 5.
    expect(sceneFiveIds.length).toBeGreaterThan(0);

    // The validator should record either a split (preferred) or no swap at
    // all; the flood-target swap shouldn't appear in fixed violations.
    const fixedTexts = (result.hard_violations_fixed as { swapped_to?: string }[]).map(
      (v) => String(v.swapped_to ?? ""),
    );
    expect(fixedTexts).not.toContain("W005-s0");
  });

  it("does not swap to a snow segment for a heat-wave narration (structural avoid_for floor)", () => {
    // Reproduces the scene-3 failure of job 8a7445b7: enforceAntiClipReuse
    // wanted to swap a heat-wave scene away from IB109 (re-used in scene 0)
    // and picked W020-s1 (snow on a house) on raw-tag-overlap alone. The
    // catalog authors annotate snow segments with `avoid_for: ["שרב"]`;
    // the structural floor must consume that and reject W020 even when the
    // narration uses noun forms ("גל החום") that escape the legacy keyword
    // blacklist.
    const heatNarration =
      "גל החום בשפלה ובביקה. אנחנו לקראת סיוע של גל החום, שהגיע בתחילת השבוע. ראשון ושני הימים החמים של השבוע, עם טמפרטורות קרובות ל-40 מעלות.";
    const heatScene = {
      idx: 7,
      start_sec: 0,
      end_sec: 11.96,
      title_he: "גל החום בשפלה",
      narration: heatNarration,
      keywords: ["חום", "שפלה", "ביקה", "טמפרטורות גבוהות"],
      mood: undefined,
      kind: "prose",
      heterogeneous: false,
    };

    const heatCatalog = [
      segClip(
        "W020",
        [
          seg(
            "W020-s1",
            0,
            11.33,
            ["שלג", "יום", "חורף", "קר", "עירוני", "טבע", "צפון"],
            "שלג יורד על בית וצמחייה בשכונה צפונית קרה.",
          ),
        ],
        11.33,
      ),
      segClip(
        "IB109",
        [
          seg(
            "IB109-s0",
            0,
            12,
            ["שמש", "יום", "חם", "כרם", "טבע"],
            "צילום רחפן של כרם ביום שמשי בהיר.",
          ),
        ],
        12,
      ),
    ];
    const heatVideoMap = Object.fromEntries(heatCatalog.map((c) => [c.id, c]));
    const heatSegmentMap = segmentMapFrom(heatCatalog);
    // Attach the indexer-authored `avoid_for` annotation that the live
    // catalog carries — without this the structural floor has nothing to
    // consume. Mirrors what `inferConcepts` would emit for a snow segment.
    (heatSegmentMap["W020-s1"].segment as { concepts?: unknown }).concepts = {
      weather: ["שלג"],
      season_mood: ["חורפי"],
      visual_role: ["עיר", "טבע"],
      scene_fit: ["טמפרטורות"],
      avoid_for: ["שרב"],
    };

    // Timeline: picker chose IB109-s0 for scene 7. We then simulate the
    // post-anti-clip-reuse scenario by also having IB109 in scene 0, which
    // forces enforceAntiClipReuse to swap scene-7's IB109 elsewhere.
    const timeline: MutablePick[] = [
      {
        scene_idx: 0,
        segment_id: "IB109-s0",
        video_id: "IB109",
        audio_start: 0,
        audio_end: 3.72,
        video_start: 0,
        video_end: 3.72,
        reason: "opening",
      },
      {
        scene_idx: 7,
        segment_id: "IB109-s0",
        video_id: "IB109",
        audio_start: 0,
        audio_end: 11.96,
        video_start: 0,
        video_end: 11.96,
        reason: "heat wave landscape",
      },
    ];

    validateAndSwap(timeline, {
      videoMap: heatVideoMap,
      segmentMap: heatSegmentMap,
      scenes: [
        {
          idx: 0,
          start_sec: 0,
          end_sec: 3.72,
          narration: "פתיחה — התחממות גל החום.",
          keywords: ["פתיחה"],
        },
        heatScene,
      ],
    });

    const sceneSevenPicks = timeline.filter((c) => c.scene_idx === 7);
    const ids = sceneSevenPicks.map((c) => c.segment_id ?? "");
    expect(ids).not.toContain("W020-s1");
  });

  it("when the only longer candidate is W005, prefers a split keeping W034", () => {
    // Strip out the neutral alternatives so W005 is the only ≥8.04s
    // candidate that meets the legacy raw-overlap gate. Without the mood
    // filter + swap-margin, the validator would lock in W005.
    const minimalCatalog = catalog.filter((c) => c.id === "W034" || c.id === "W005");
    const minimalVideoMap = Object.fromEntries(minimalCatalog.map((c) => [c.id, c]));
    const minimalSegmentMap = segmentMapFrom(minimalCatalog);

    const timeline = buildTimeline();
    validateAndSwap(timeline, {
      videoMap: minimalVideoMap,
      segmentMap: minimalSegmentMap,
      scenes: [sceneFive],
    });

    const sceneFivePicks = timeline.filter((c) => c.scene_idx === 4);
    const picks = sceneFivePicks.map((c) => c.segment_id ?? "");

    expect(picks).not.toContain("W005-s0");
    // Original W034 should still anchor the scene (either alone with the
    // coverage gap left as a warning, or as head of a split).
    expect(picks).toContain("W034-s0");
  });
});
