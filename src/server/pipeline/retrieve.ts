/**
 * Ver2 retrieval — shortlist N=12 catalog candidates per scene.
 *
 * Replaces "dump the full catalog to the picker" with a small, tier-shuffled
 * slate keyed off the scene's narration + planner-emitted `desired_concepts`.
 * The shortlist is the only place where "hardcoded" gates live (mood,
 * clothing, min duration). Everything editorial is decided downstream by the
 * picker LLM looking at the slate.
 *
 * Variety: tier-shuffle uses a render_seed-seeded PRNG so the same seed
 * reproduces, and different seeds yield visibly different presentations of
 * equally-good candidates.
 */

import type {
  Scene,
  ParsedVideo,
  NormalisedSegment,
  SegmentConcepts,
  ShortlistEntry,
} from "@/shared/types";
import { buildBm25Index, bm25Score, tokenize, type Bm25Doc } from "./bm25";
import { isClothingText, isClothingTag } from "./beat-tagger";

const SHORTLIST_K_DEFAULT = 15;
const MIN_CLIP_DURATION = 3.0;
const THIN_SHORTLIST_CLIP_THRESHOLD = 4;

// Mirror of the ver1 validator's MOOD_INCOMPATIBLE map — kept narrow on purpose.
const MOOD_INCOMPATIBLE: Record<string, ReadonlyArray<string>> = {
  calm: ["סופה", "ברד", "שיטפון", "דרמטי", "שטף", "דרמה", "אסון"],
  cheerful: ["סופה", "ברד", "שיטפון", "קודר", "אבל"],
  dramatic: ["רגוע"],
};

// Concept-overlap weights: weather is dominant, then season, then visual/scene_fit.
const CONCEPT_WEIGHTS: Record<keyof Omit<SegmentConcepts, "avoid_for">, number> = {
  weather: 3,
  season_mood: 2,
  visual_role: 1.5,
  scene_fit: 1.5,
};
const AVOID_PENALTY = 3;
const BM25_WEIGHT = 1.0;

export interface RetrievalOptions {
  renderSeed: number;
  k?: number;
}

export interface RetrievalResult {
  shortlist: ShortlistEntry[];
  /** True when the shortlist offers fewer than 4 distinct parent files. */
  shortlist_thin: boolean;
}

interface CandidateInternal {
  segment_id: string;
  clip_id: string;
  segment: NormalisedSegment;
  clip: ParsedVideo;
}

// mulberry32 PRNG — small, deterministic, seeded.
function mulberry32(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffleInPlace<T>(arr: T[], rng: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function allCandidates(videos: ParsedVideo[]): CandidateInternal[] {
  const out: CandidateInternal[] = [];
  for (const clip of videos) {
    for (const seg of clip.segments ?? []) {
      if (!seg.id) continue;
      out.push({ segment_id: seg.id, clip_id: clip.id, segment: seg, clip });
    }
  }
  return out;
}

function segmentBag(seg: NormalisedSegment): string[] {
  const c = seg.concepts;
  const words: string[] = [
    ...(seg.tags ?? []),
    ...(c?.weather ?? []),
    ...(c?.season_mood ?? []),
    ...(c?.visual_role ?? []),
    ...(c?.scene_fit ?? []),
  ];
  if (seg.description) words.push(...tokenize(seg.description));
  return words.map((w) => String(w).toLowerCase().trim()).filter(Boolean);
}

function conceptOverlap(
  desired: Partial<SegmentConcepts> | undefined,
  segConcepts: SegmentConcepts | undefined,
): number {
  if (!desired || !segConcepts) return 0;
  let score = 0;
  for (const key of ["weather", "season_mood", "visual_role", "scene_fit"] as const) {
    const want = desired[key];
    if (!want || !want.length) continue;
    const have = segConcepts[key] ?? [];
    if (!have.length) continue;
    const wantSet = new Set(want);
    let hits = 0;
    for (const v of have) if (wantSet.has(v)) hits++;
    score += hits * CONCEPT_WEIGHTS[key];
  }
  const avoid = segConcepts.avoid_for ?? [];
  if (avoid.length) {
    const desiredBag = new Set<string>([
      ...(desired.weather ?? []),
      ...(desired.season_mood ?? []),
      ...(desired.scene_fit ?? []),
    ]);
    for (const a of avoid) if (desiredBag.has(a)) score -= AVOID_PENALTY;
  }
  return score;
}

function passesMoodGate(mood: string | undefined, seg: NormalisedSegment): boolean {
  if (!mood) return true;
  const banned = MOOD_INCOMPATIBLE[mood.toLowerCase()];
  if (!banned) return true;
  const desc = (seg.description ?? "").toLowerCase();
  const tagsLower = (seg.tags ?? []).map((t) => t.toLowerCase());
  for (const b of banned) {
    const bLow = b.toLowerCase();
    if (desc.includes(bLow)) return false;
    if (tagsLower.some((t) => t.includes(bLow))) return false;
  }
  return true;
}

function passesClothingGate(sceneText: string, seg: NormalisedSegment): boolean {
  if (isClothingText(sceneText)) return true;
  const hasClothingTag = (seg.tags ?? []).some((t) => isClothingTag(t));
  return !hasClothingTag;
}

function passesCoverageGate(seg: NormalisedSegment): boolean {
  return (seg.end_sec ?? 0) - (seg.start_sec ?? 0) >= MIN_CLIP_DURATION;
}

function tierFromIndex(idx: number, total: number): 1 | 2 | 3 | 4 | 5 {
  if (total <= 1) return 1;
  const frac = idx / total;
  if (frac < 0.2) return 1;
  if (frac < 0.4) return 2;
  if (frac < 0.6) return 3;
  if (frac < 0.8) return 4;
  return 5;
}

export function retrieveCandidates(
  scene: Scene,
  videos: ParsedVideo[],
  opts: RetrievalOptions,
): RetrievalResult {
  const k = opts.k ?? SHORTLIST_K_DEFAULT;
  const all = allCandidates(videos);

  // Mechanical gates (mood / clothing / min-duration). These are not editorial
  // judgement — they're the same gates the ver1 validator applied after the fact.
  const gated = all.filter(
    (c) =>
      passesMoodGate(scene.mood, c.segment) &&
      passesClothingGate(scene.narration ?? "", c.segment) &&
      passesCoverageGate(c.segment),
  );

  // BM25 over gated segments using scene narration + keywords as the query.
  const docs: Bm25Doc[] = gated.map((c) => ({
    id: c.segment_id,
    words: segmentBag(c.segment),
  }));
  const index = buildBm25Index(docs);

  const queryTerms = [
    ...tokenize(scene.narration ?? ""),
    ...(scene.keywords ?? []).flatMap((k) => tokenize(k)),
    ...(scene.desired_keywords ?? []).flatMap((k) => tokenize(k)),
  ];

  const scored = gated.map((c) => ({
    c,
    score:
      bm25Score(queryTerms, c.segment_id, index) * BM25_WEIGHT +
      conceptOverlap(scene.desired_concepts, c.segment.concepts),
  }));
  scored.sort((a, b) => b.score - a.score);

  // Tier-shuffle: bucket by quintile of sorted position, shuffle within bucket,
  // then re-flatten in tier order. Preserves relevance, randomizes presentation.
  const rng = mulberry32(opts.renderSeed);
  const buckets: Array<Array<{ c: CandidateInternal; score: number }>> = [[], [], [], [], []];
  for (let i = 0; i < scored.length; i++) {
    buckets[tierFromIndex(i, scored.length) - 1].push(scored[i]);
  }
  for (const b of buckets) shuffleInPlace(b, rng);
  const shuffled = buckets.flat();
  const top = shuffled.slice(0, k);

  const distinctClips = new Set(top.map((s) => s.c.clip_id));
  const shortlist: ShortlistEntry[] = top.map((s, i) => {
    const seg = s.c.segment;
    const start = Math.round((seg.start_sec ?? 0) * 100) / 100;
    const end = Math.round((seg.end_sec ?? 0) * 100) / 100;
    return {
      segment_id: s.c.segment_id,
      clip_id: s.c.clip_id,
      start_sec: start,
      end_sec: end,
      duration: Math.round(Math.max(0, end - start) * 100) / 100,
      orientation: s.c.clip.orientation,
      source: s.c.clip.source,
      tags: seg.tags ?? [],
      description: (seg.description ?? "").length > 260
        ? `${(seg.description ?? "").slice(0, 257)}...`
        : (seg.description ?? ""),
      concepts: seg.concepts,
      score: Math.round(s.score * 100) / 100,
      tier: tierFromIndex(i, top.length),
    };
  });

  return {
    shortlist,
    shortlist_thin: distinctClips.size < THIN_SHORTLIST_CLIP_THRESHOLD,
  };
}
