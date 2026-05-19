// @vitest-environment node
import { describe, expect, it } from "vitest";
import { retrieveCandidates } from "@/server/pipeline/retrieve";
import type { ParsedVideo, Scene } from "@/shared/types";

function makeSegment(
  id: string,
  description: string,
  tags: string[],
  weather: string[],
): ParsedVideo["segments"][number] {
  return {
    id,
    start_sec: 0,
    end_sec: 6,
    description,
    tags,
    concepts: {
      weather,
      season_mood: [],
      visual_role: [],
      scene_fit: [],
      avoid_for: [],
    },
  };
}

function makeClip(
  id: string,
  segments: ParsedVideo["segments"],
): ParsedVideo {
  return {
    id,
    filename: `${id}.mp4`,
    description: "",
    path: `/tmp/${id}.mp4`,
    availability: "local",
    duration_sec: 12,
    orientation: "V",
    source: "original",
    tags: { main: "", secondary: "", third: "" },
    segments,
  };
}

/** Build a varied catalog: 8 distinct files × 2 segments each, mixed weather. */
function buildCatalog(): ParsedVideo[] {
  const videos: ParsedVideo[] = [];
  const themes: Array<{ desc: string; tag: string; weather: string }> = [
    { desc: "שמיים אפורים מעל העיר", tag: "מעונן", weather: "מעונן" },
    { desc: "טפטוף קל ברחובות", tag: "טפטוף", weather: "גשם" },
    { desc: "עננים כבדים מעל ההר", tag: "עננים", weather: "מעונן" },
    { desc: "גשם קל על השמשה", tag: "גשם", weather: "גשם" },
    { desc: "שמיים אפורים שקטים", tag: "אפור", weather: "מעונן" },
    { desc: "רחוב עירוני רטוב", tag: "רטוב", weather: "גשם" },
    { desc: "נוף הררי מעונן", tag: "הר", weather: "מעונן" },
    { desc: "שעה אפורה ברחוב", tag: "עירוני", weather: "מעונן" },
  ];
  for (let i = 0; i < themes.length; i++) {
    const id = `CL${String(i).padStart(3, "0")}`;
    const t = themes[i];
    videos.push(
      makeClip(id, [
        makeSegment(`${id}-s0`, t.desc, [t.tag, "מעונן"], [t.weather]),
        makeSegment(`${id}-s1`, `${t.desc} (זווית אחרת)`, [t.tag, "אווירה"], [t.weather]),
      ]),
    );
  }
  return videos;
}

const baseScene: Scene = {
  idx: 0,
  start_sec: 0,
  end_sec: 8,
  title_he: "פתיחה",
  narration: "השמיים מעוננים והעננים כבדים, צפוי טפטוף קל לפני הצהריים.",
  keywords: ["מעונן", "טפטוף", "עננים"],
  mood: "calm",
  kind: "prose",
  heterogeneous: false,
  whisper_beat_indices: [],
  desired_concepts: { weather: ["מעונן", "גשם"] },
  desired_keywords: ["שמיים אפורים", "טפטוף"],
};

describe("retrieveCandidates — variety", () => {
  it("same renderSeed produces identical shortlists (reproducibility)", () => {
    const videos = buildCatalog();
    const a = retrieveCandidates(baseScene, videos, { renderSeed: 42 }).shortlist;
    const b = retrieveCandidates(baseScene, videos, { renderSeed: 42 }).shortlist;
    expect(a.map((s) => s.segment_id)).toEqual(b.map((s) => s.segment_id));
  });

  it("different renderSeeds produce visibly different shortlist orderings", () => {
    const videos = buildCatalog();
    const seeds = [1, 7, 13, 99, 1001];
    const orderings = seeds.map(
      (s) =>
        retrieveCandidates(baseScene, videos, { renderSeed: s }).shortlist
          .map((e) => e.segment_id)
          .join(","),
    );
    const distinct = new Set(orderings);
    // At least 3 of 5 seeds must produce different orderings — the catalog is
    // diverse enough that tier-shuffle should not converge to a single result.
    expect(distinct.size).toBeGreaterThanOrEqual(3);
  });

  it("top-K=12 default; relevance preserved across tiers", () => {
    const videos = buildCatalog();
    const { shortlist } = retrieveCandidates(baseScene, videos, { renderSeed: 1 });
    expect(shortlist.length).toBeLessThanOrEqual(12);
    expect(shortlist.length).toBeGreaterThan(0);
    // Tiers must be monotonic in the returned order (1, 1, 2, 2, ...) since
    // we flatten buckets in tier order.
    let lastTier = 0;
    for (const e of shortlist) {
      expect(e.tier).toBeGreaterThanOrEqual(lastTier);
      lastTier = e.tier;
    }
  });

  it("flags shortlist_thin when fewer than 4 distinct clip_ids appear in top-K", () => {
    // Build a catalog where every viable segment lives on 2 clips (clusters)
    const cluster: ParsedVideo[] = [
      makeClip("HOT001", [
        makeSegment("HOT001-s0", "שרב כבד", ["שרב", "חם"], ["שרב", "חם"]),
        makeSegment("HOT001-s1", "עומס חום", ["חם", "קיץ"], ["חם"]),
      ]),
      makeClip("HOT002", [
        makeSegment("HOT002-s0", "יום חם מאוד", ["חם"], ["חם"]),
        makeSegment("HOT002-s1", "אוויר יבש", ["חם", "קיץ"], ["חם"]),
      ]),
    ];
    const heatScene: Scene = {
      ...baseScene,
      narration: "גל חום כבד, שרב",
      keywords: ["חם", "שרב"],
      desired_concepts: { weather: ["חם", "שרב"] },
      desired_keywords: ["שרב", "עומס חום"],
    };
    const { shortlist, shortlist_thin } = retrieveCandidates(heatScene, cluster, {
      renderSeed: 1,
    });
    expect(shortlist_thin).toBe(true);
    expect(shortlist.length).toBeGreaterThan(0);
  });
});
