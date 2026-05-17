import {
  isClothingTag,
  isClothingText,
  isHotWeatherNarration,
  isColdWeatherNarration,
  isOvercastNarration,
  clothingClimateMismatch,
} from "./beat-tagger";
import { PLACE_ALIASES } from "./hebrew-places";
import { inferConcepts, targetContradictsSegment, weatherClassMismatch } from "@/server/catalog/hebrew-taxonomy";
import type { SegmentConcepts } from "@/shared/types";

// ---------------------------------------------------------------------------
// Constants (mirror plan_validator.py)
// ---------------------------------------------------------------------------

const MAX_REPEATS = 2;
const RECENCY_WINDOW_SCENES = 2;
const MIN_CLIP_DURATION = 3.0;
const COVERAGE_GAP_TOLERANCE = 0.5;
const THEMATIC_ADJACENCY_RUN_LEN = 3;

/** Max timeline picks sharing one parent video when "different segment" exception might apply. */
const SAME_CLIP_MAX_PICKS = 2;
/** Tag Jaccard (segment-only tags) must be at or below this to count as different concepts. */
const SAME_CLIP_TAG_JACCARD_MAX = 0.35;
/** Description token Jaccard ceiling when both descriptions are substantive. */
const SAME_CLIP_DESC_TOKEN_JACCARD_MAX = 0.55;
const MIN_SEGMENT_CONCEPT_DESC_LEN = 8;
/** Min tag-word hits between beat/scene text and candidate tags for validator swaps/fills (primary segment path). */
const MIN_SWAP_TAG_OVERLAP = 2;

// ---------------------------------------------------------------------------
// Ranking constants (BM25 + mood + swap-margin)
// ---------------------------------------------------------------------------

/** BM25 term-frequency saturation. Standard Elastic default. */
const BM25_K1 = 1.2;
/** BM25 length-normalization. 0.75 penalizes over-tagged ("junk-tag") clips. */
const BM25_B = 0.75;
/**
 * Wholesale-swap margin for enforceCoverage Strategy 1: the new candidate must
 * exceed the original pick's BM25 score by at least this fraction of the
 * original to justify discarding the upstream LLM's narrative intent. Below
 * the margin, fall through to Strategy 2 (split + residual). Per SBERT's
 * retrieve-and-rerank guidance, ~25% is the working threshold for whole
 * replacement (as opposed to ~10–15% for in-place rerank).
 */
const SWAP_MARGIN_FRACTION = 0.25;

/**
 * Mood mismatch hard floor: scene `mood` → segment tag/description words that
 * disqualify a candidate *before* scoring. Loose by design — only the obvious
 * opposites. Catalog vocabulary is closed (see `hebrew-taxonomy.ts`), so this
 * stays small.
 */
const MOOD_INCOMPATIBLE: Record<string, ReadonlyArray<string>> = {
  calm: ["סופה", "ברד", "שיטפון", "דרמטי", "שטף", "דרמה", "אסון"],
  cheerful: ["סופה", "ברד", "שיטפון", "קודר", "אבל"],
  dramatic: ["רגוע"],
};

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

export interface MutablePick {
  scene_idx?: number | null;
  segment_id?: string;
  video_id?: string;
  audio_start: number;
  audio_end: number;
  video_start?: number;
  video_end?: number;
  beat_idx?: number;
  reason?: string;
  /** Set before validateAndSwap; preserved for UI (LLM editorial copy). */
  picker_reason?: string;
  /** Hebrew editorial copy generated when validator changes or fills a pick. */
  fallback_reason?: string;
}

type SegmentEntry = {
  id?: string;
  start_sec?: number | string;
  end_sec?: number | string;
  description?: string;
  tags?: string[] | Record<string, string>;
  concepts?: SegmentConcepts;
  confidence?: number;
};

type CatalogClip = {
  id?: string;
  duration_sec?: number | string;
  tags?: string[] | Record<string, string>;
  description?: string;
  segments?: SegmentEntry[];
};

type SegmentMapEntry = {
  clip: CatalogClip;
  segment: SegmentEntry;
};

type WhisperBeat = {
  idx: number;
  start: number;
  end: number;
  text: string;
};

type SceneDict = {
  idx: number;
  start_sec: number;
  end_sec: number;
  narration?: string;
  keywords?: string[];
  mood?: string;
  kind?: string;
  heterogeneous?: boolean;
};

export interface ValidatorBundle {
  score: number;
  /**
   * Categorical advisory for downstream workers / UI. Computed from kept-hard-
   * violations and failed gap fills, NOT from `score` (which under-penalised
   * unfixed mismatches and made 77/100 plans look ship-ready).
   *   - ship    : no kept hard violations, no failed gap fills
   *   - review  : 1 kept hard violation OR 1 failed gap fill — surface to user
   *   - replan  : 2+ kept hard violations OR 2+ failed gap fills — auto-retry
   */
  quality: "ship" | "review" | "replan";
  hard_violations_fixed: Record<string, unknown>[];
  hard_violations_kept: Record<string, unknown>[];
  warnings: Record<string, unknown>[];
  catalog_health: Record<string, unknown>;
  gap_filled?: Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// Reverse alias map (alias → slug) for _aliasedOverlap
// ---------------------------------------------------------------------------

const ALL_ALIASES: Record<string, string> = {};
for (const [slug, aliases] of Object.entries(PLACE_ALIASES)) {
  for (const alias of aliases) {
    ALL_ALIASES[alias.toLowerCase()] = slug;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeFloat(value: unknown, def = 0.0): number {
  if (value == null) return def;
  const n = parseFloat(String(value));
  return isNaN(n) ? def : n;
}

function pickKey(clip: MutablePick): string {
  return clip.segment_id || clip.video_id || "";
}

function audioLen(clip: MutablePick): number {
  return safeFloat(clip.audio_end) - safeFloat(clip.audio_start);
}

function videoLen(clip: MutablePick): number {
  return safeFloat(clip.video_end) - safeFloat(clip.video_start);
}

function tally(items: (string | undefined)[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    if (!it) continue;
    out[it] = (out[it] ?? 0) + 1;
  }
  return out;
}

function segmentDuration(segment: SegmentEntry): number {
  return safeFloat(segment.end_sec) - safeFloat(segment.start_sec);
}

// ---------------------------------------------------------------------------
// Tag word extraction
// ---------------------------------------------------------------------------

function videoTagWords(video: CatalogClip | null | undefined): string[] {
  if (!video) return [];
  const tags = video.tags;
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t));
  if (typeof tags === "object") {
    return [
      (tags as Record<string, string>).main ?? "",
      (tags as Record<string, string>).secondary ?? "",
      (tags as Record<string, string>).third ?? "",
    ];
  }
  return [];
}

function segmentTagWords(segment: SegmentEntry | null | undefined): string[] {
  if (!segment) return [];
  const tags = segment.tags;
  if (!tags) return [];
  if (Array.isArray(tags)) return tags.map((t) => String(t));
  return [];
}

function entryTagWords(segment: SegmentEntry | null | undefined, video: CatalogClip | null | undefined): string[] {
  const segWords = segmentTagWords(segment).filter(Boolean);
  const concepts = segment?.concepts;
  const conceptWords = [
    ...(concepts?.weather ?? []),
    ...(concepts?.season_mood ?? []),
    ...(concepts?.visual_role ?? []),
    ...(concepts?.scene_fit ?? []),
    segment?.description ?? "",
  ].filter(Boolean);
  const words = [...new Set([...segWords, ...conceptWords])];
  if (words.length) return words;
  return videoTagWords(video).filter(Boolean);
}

function hasAnyClothingTag(segment: SegmentEntry | null | undefined, video: CatalogClip | null | undefined): boolean {
  return entryTagWords(segment, video).some((t) => isClothingTag(t));
}

// ---------------------------------------------------------------------------
// Schema v2 helpers
// ---------------------------------------------------------------------------

const CLOUDS_DECORATIVE_COMPANIONS = new Set([
  "sun", "summer", "partly_cloudy", "clear_sky", "golden_hour",
  "dusk", "cheerful", "hot", "warm",
  "שמש", "קיץ", "מעונן חלקית", "שמיים בהירים", "שעת זהב",
  "בין ערביים", "שמח", "חם", "חמים", "בהיר", "קיצי",
]);

const CLOUDS_OVERCAST_COMPANIONS = new Set([
  "gloomy", "rain", "winter", "storm", "fog", "hail", "overcast", "cold",
  "קודר", "גשם", "חורף", "סופה", "ערפל", "ברד", "מעונן", "קר", "חורפי",
]);

function cloudsIntent(tags: string[]): "decorative" | "overcast" | "ambiguous" | "none" {
  const s = new Set(tags.map((t) => String(t).toLowerCase()));
  const hasCloudsLike = s.has("clouds") || s.has("partly_cloudy") || s.has("overcast") || s.has("עננים") || s.has("מעונן חלקית") || s.has("מעונן");
  if (!hasCloudsLike) return "none";
  if (s.has("overcast") || s.has("מעונן")) return "overcast";
  if (s.has("partly_cloudy") || s.has("מעונן חלקית")) return "decorative";
  for (const c of CLOUDS_DECORATIVE_COMPANIONS) if (s.has(c)) return "decorative";
  for (const c of CLOUDS_OVERCAST_COMPANIONS) if (s.has(c)) return "overcast";
  return "ambiguous";
}

function aliasedOverlap(targetLower: string, tagWord: string): number {
  if (!targetLower || !tagWord) return 0;
  const tw = tagWord.toLowerCase();
  const slug = ALL_ALIASES[tw];
  if (!slug) return 0;
  const aliases = PLACE_ALIASES[slug] ?? [];
  for (const alias of aliases) {
    if (targetLower.includes(alias.toLowerCase())) return 1;
  }
  return 0;
}

// ---------------------------------------------------------------------------
// BM25 + mood helpers
// ---------------------------------------------------------------------------

interface Bm25Cache {
  docs: Map<string, string[]>;
  avgDl: number;
  idf: Map<string, number>;
}

/**
 * Build a BM25 index over the candidate set. O(N) over ~200 catalog entries.
 * Memoized by the `candidates` array identity — `segmentCandidates(segmentMap)`
 * returns the same instance across all enforce-* passes of one validator
 * run, so we pay the build cost once per render instead of ~10×.
 */
const _bm25CacheByCandidates = new WeakMap<Candidate[], Bm25Cache>();

function buildBm25Cache(candidates: Candidate[]): Bm25Cache {
  const cached = _bm25CacheByCandidates.get(candidates);
  if (cached) return cached;
  const built = _buildBm25CacheUncached(candidates);
  _bm25CacheByCandidates.set(candidates, built);
  return built;
}

function _buildBm25CacheUncached(candidates: Candidate[]): Bm25Cache {
  const docs = new Map<string, string[]>();
  const df = new Map<string, number>();
  let totalLen = 0;
  for (const [id, seg, vid] of candidates) {
    const words = entryTagWords(seg, vid).map((w) => String(w).toLowerCase()).filter(Boolean);
    docs.set(id, words);
    totalLen += words.length;
    for (const w of new Set(words)) df.set(w, (df.get(w) ?? 0) + 1);
  }
  const n = candidates.length || 1;
  const idf = new Map<string, number>();
  for (const [w, f] of df) idf.set(w, Math.log(1 + (n - f + 0.5) / (f + 0.5)));
  return { docs, avgDl: totalLen / n, idf };
}

/**
 * BM25 relevance of `candidateId` to `targetLower`. Score 0 means no matching
 * tag; higher = better fit. Length-normalized (`BM25_B=0.75`) so junk-tag
 * clips don't win by sheer tag count.
 */
function bm25Score(targetLower: string, candidateId: string, cache: Bm25Cache): number {
  const words = cache.docs.get(candidateId);
  if (!words || !words.length) return 0;
  const dl = words.length;
  const avg = cache.avgDl || 1;
  const seen = new Set<string>();
  let score = 0;
  for (const w of words) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    if (!(targetLower.includes(w) || aliasedOverlap(targetLower, w) > 0)) continue;
    const tf = words.reduce((n, x) => (x === w ? n + 1 : n), 0);
    const idf = cache.idf.get(w) ?? 0;
    const norm = tf + BM25_K1 * (1 - BM25_B + BM25_B * (dl / avg));
    score += idf * ((BM25_K1 + 1) * tf) / norm;
  }
  return score;
}

/**
 * Tag-word hit count (the legacy raw-overlap metric). Kept as the integer
 * threshold for `requireMinOverlap` and for the Hebrew swap message
 * (`חפיפת תגיות=N`); BM25 is used only for ranking among the passing set.
 */
function rawOverlapCount(targetLower: string, candidateId: string, cache: Bm25Cache): number {
  const words = cache.docs.get(candidateId) ?? [];
  if (!targetLower) return 0;
  const seen = new Set<string>();
  let n = 0;
  for (const w of words) {
    if (!w || seen.has(w)) continue;
    seen.add(w);
    if (targetLower.includes(w) || aliasedOverlap(targetLower, w) > 0) n++;
  }
  return n;
}

/**
 * Mood floor: reject a candidate when the scene mood is set and the candidate's
 * tags or description contain a tonal opposite. Loose — only fires on the
 * obvious mismatches listed in `MOOD_INCOMPATIBLE`.
 */
// Visual-text per segment is reused across many candidate-scoring passes; the
// concat + lowercase isn't cheap when called 200× per loop. Memoize by the
// segment object identity (segmentCandidates returns the same instances).
const _segmentVisualLowerCache = new WeakMap<SegmentEntry, string>();
function segmentVisualLower(segment: SegmentEntry, video: CatalogClip): string {
  const cached = _segmentVisualLowerCache.get(segment);
  if (cached !== undefined) return cached;
  const text = segmentVisualText(segment, video).toLowerCase();
  _segmentVisualLowerCache.set(segment, text);
  return text;
}

function moodIsIncompatible(
  mood: string | undefined | null,
  segment: SegmentEntry,
  video: CatalogClip,
): boolean {
  if (!mood) return false;
  const banned = MOOD_INCOMPATIBLE[String(mood).toLowerCase()];
  if (!banned) return false;
  const visual = segmentVisualLower(segment, video);
  if (!visual) return false;
  return banned.some((bad) => visual.includes(bad.toLowerCase()));
}

/**
 * Lookup helper: read the scene mood for a given pick, returning null when the
 * scene isn't known or carries no mood. Centralised so the field plumbs to all
 * callers of `bestCandidateByOverlap`.
 */
function moodForClip(
  clip: MutablePick,
  scenesByIdx: Record<number, SceneDict> | undefined,
): string | null {
  if (!scenesByIdx || clip.scene_idx == null) return null;
  return scenesByIdx[clip.scene_idx]?.mood ?? null;
}

// ---------------------------------------------------------------------------
// Structural semantic floor (avoid_for ∩ scene concepts)
// ---------------------------------------------------------------------------

// Polarity / transition narrations — the scene mentions a weather state but
// is announcing its *end* or a *return to normal*. Tagging by literal word
// match is unreliable here (a heat-wave-is-ending scene reads as "heat" to
// inferConcepts), so the structural floor must NOT fire and reject the
// calm/normal candidates that actually belong on screen. The picker prompt
// rule A4 covers this on the upstream side; this check just disengages the
// downstream filter so it doesn't override the picker.
const POLARITY_ENDING_RE = /(מסתיים|מסתיימת|סיום|ירידה|נחזור\s*ל|חזרה\s*ל|חזרה\s*לעונה|התקררות|רגוע\s*יותר|פחות\s*חם)/;

function narrationIsTransitional(text: string | null | undefined): boolean {
  if (!text) return false;
  return POLARITY_ENDING_RE.test(text);
}

/**
 * Compute the scene's inferred concepts for the avoid_for floor. Returns null
 * when the narration is transitional (announcing a weather state ending) —
 * in that case the literal heat/cold word in the text doesn't reflect what
 * should be on screen, so the structural floor should not fire.
 */
function inferSceneConcepts(scene: SceneDict | undefined): SegmentConcepts | null {
  if (!scene) return null;
  const description = String(scene.narration ?? "").trim();
  const keywords = (scene.keywords ?? []).map((k) => String(k).trim()).filter(Boolean);
  if (!description && !keywords.length) return null;
  if (narrationIsTransitional(description)) return null;
  return inferConcepts({ description, tags: keywords });
}

/**
 * Convenience: build the `{mood, sceneConcepts}` slice every swap call site
 * wants. Spread into a `bestCandidateByOverlap` / `bestLegacyCandidate` opts
 * bag to apply the same structural floor everywhere.
 *
 * `inferSceneConcepts` is non-trivial; we memoize by scene-object identity
 * via WeakMap so a job with 5 scenes pays the cost 5 times across all
 * validator passes, not 5 × N-call-sites.
 */
const _sceneConceptsCache = new WeakMap<SceneDict, SegmentConcepts | null>();

function semanticFloorFor(
  clip: MutablePick,
  scenesByIdx: Record<number, SceneDict> | undefined,
): { mood: string | null; sceneConcepts: SegmentConcepts | null } {
  const scene = scenesByIdx && clip.scene_idx != null ? scenesByIdx[clip.scene_idx] : undefined;
  if (!scene) return { mood: null, sceneConcepts: null };
  let sceneConcepts = _sceneConceptsCache.get(scene);
  if (sceneConcepts === undefined) {
    sceneConcepts = inferSceneConcepts(scene);
    _sceneConceptsCache.set(scene, sceneConcepts);
  }
  return { mood: scene.mood ?? null, sceneConcepts };
}

/**
 * Structural reject: returns true if the candidate carries an `avoid_for`
 * value that intersects the scene's concept set. Used in addition to (not in
 * place of) `targetContradictsSegment`, since the structural data is curated
 * per-segment by the indexer and avoids the keyword-blacklist trap.
 */
function sceneAvoidsSegment(
  sceneConcepts: SegmentConcepts | null,
  source: { concepts?: SegmentConcepts } | null | undefined,
): boolean {
  if (!sceneConcepts) return false;
  const avoid = source?.concepts?.avoid_for ?? [];
  if (!avoid.length) return false;
  const sceneBag = new Set<string>([
    ...(sceneConcepts.weather ?? []),
    ...(sceneConcepts.season_mood ?? []),
    ...(sceneConcepts.scene_fit ?? []),
  ]);
  if (!sceneBag.size) return false;
  return avoid.some((a) => sceneBag.has(a));
}

function segmentVisualText(segment: SegmentEntry | null | undefined, video: CatalogClip | null | undefined): string {
  const parts: string[] = [];
  const desc = segment?.description;
  if (desc) parts.push(String(desc));
  parts.push(...entryTagWords(segment, video));
  return parts.filter(Boolean).join(" ");
}

function shortVisualLabel(segment: SegmentEntry | null | undefined, video: CatalogClip | null | undefined): string {
  const desc = String(segment?.description ?? video?.description ?? "").trim();
  if (desc) return desc.length > 80 ? `${desc.slice(0, 77)}...` : desc;
  const words = entryTagWords(segment, video)
    .map((w) => String(w).trim())
    .filter(Boolean)
    .slice(0, 4);
  return words.length ? words.join(", ") : "צילום שמתאים לאופי הסצינה";
}

function validatorEditorialReason(
  segment: SegmentEntry | null | undefined,
  video: CatalogClip | null | undefined,
  action = "נבחר לאחר בדיקת התאמה אוטומטית",
): string {
  return `${action}: הקטע מציג ${shortVisualLabel(segment, video)}.`;
}

function entryTagWordsForPick(
  clip: MutablePick,
  segmentMap: Record<string, SegmentMapEntry>,
  videoMap: Record<string, CatalogClip>,
): string[] {
  const segId = clip.segment_id;
  if (segId && segmentMap[segId]) {
    const entry = segmentMap[segId];
    return entryTagWords(entry.segment, entry.clip);
  }
  return videoTagWords(videoMap[clip.video_id ?? ""] ?? {});
}

// ---------------------------------------------------------------------------
// Beat / scene text
// ---------------------------------------------------------------------------

function beatText(clip: MutablePick, beatsByIdx: Record<number, WhisperBeat>): string {
  if (clip.beat_idx == null) return "";
  const b = beatsByIdx[clip.beat_idx];
  return b?.text ?? "";
}

function sceneText(clip: MutablePick, scenesByIdx: Record<number, SceneDict>): string {
  if (!scenesByIdx || clip.scene_idx == null) return "";
  const s = scenesByIdx[clip.scene_idx];
  if (!s) return "";
  return ((s.narration ?? "") + " " + (s.keywords ?? []).join(" ")).trim();
}

function targetText(
  clip: MutablePick,
  beatsByIdx: Record<number, WhisperBeat>,
  scenesByIdx: Record<number, SceneDict>,
): string {
  return sceneText(clip, scenesByIdx) || beatText(clip, beatsByIdx);
}

// ---------------------------------------------------------------------------
// Candidate tuples
// ---------------------------------------------------------------------------

type Candidate = [string, SegmentEntry, CatalogClip];

// Memoize the candidate array by the segmentMap identity so every enforce*
// pass within a single validateAndSwap call gets the same array reference;
// downstream caches (BM25, visual text) can then key by that identity.
const _candidatesBySegmentMap = new WeakMap<Record<string, SegmentMapEntry>, Candidate[]>();
function segmentCandidates(segmentMap: Record<string, SegmentMapEntry>): Candidate[] {
  if (!segmentMap) return [];
  const cached = _candidatesBySegmentMap.get(segmentMap);
  if (cached) return cached;
  const built: Candidate[] = Object.entries(segmentMap).map(([sid, e]) => [sid, e.segment, e.clip]);
  _candidatesBySegmentMap.set(segmentMap, built);
  return built;
}

// ---------------------------------------------------------------------------
// Same-clip reuse (segment concept / poster proxy from tags + description only)
// ---------------------------------------------------------------------------

function segmentOnlyTagSet(segment: SegmentEntry | null | undefined): Set<string> {
  const raw = segmentTagWords(segment).filter(Boolean);
  return new Set(raw.map((t) => String(t).trim().toLowerCase()).filter(Boolean));
}

function descriptionTokenSet(segment: SegmentEntry | null | undefined): Set<string> {
  const d = String(segment?.description ?? "")
    .trim()
    .toLowerCase();
  if (!d) return new Set();
  const parts = d.split(/[\s\u200f\u200e,.;:!?'"()[\]{}]+/).filter((w) => w.length >= 2);
  return new Set(parts);
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) {
    if (b.has(x)) inter++;
  }
  const union = a.size + b.size - inter;
  return union <= 0 ? 1 : inter / union;
}

function segmentHasConceptSignal(segment: SegmentEntry | null | undefined): boolean {
  if (segmentOnlyTagSet(segment).size >= 1) return true;
  return String(segment?.description ?? "").trim().length >= MIN_SEGMENT_CONCEPT_DESC_LEN;
}

/**
 * Whether two segments on the same parent clip may both appear on one timeline.
 */
export function sameClipReuseAllowed(segA: SegmentEntry, segB: SegmentEntry): boolean {
  if (!segmentHasConceptSignal(segA) || !segmentHasConceptSignal(segB)) return false;

  const tA = segmentOnlyTagSet(segA);
  const tB = segmentOnlyTagSet(segB);
  const dA = descriptionTokenSet(segA);
  const dB = descriptionTokenSet(segB);

  if (tA.size >= 1 && tB.size >= 1) {
    const jacTags = jaccardSimilarity(tA, tB);
    const disjointMulti = jacTags === 0 && tA.size >= 2 && tB.size >= 2;
    if (!disjointMulti && jacTags > SAME_CLIP_TAG_JACCARD_MAX) return false;

    if (dA.size >= 2 && dB.size >= 2) {
      if (jaccardSimilarity(dA, dB) > SAME_CLIP_DESC_TOKEN_JACCARD_MAX) return false;
    }
    return true;
  }

  if (dA.size < 2 || dB.size < 2) return false;
  return jaccardSimilarity(dA, dB) <= SAME_CLIP_DESC_TOKEN_JACCARD_MAX;
}

// ---------------------------------------------------------------------------
// _bestCandidateByOverlap
// ---------------------------------------------------------------------------

function bestCandidateByOverlap(
  candidates: Candidate[],
  opts: {
    targetText: string;
    usedCounts: Record<string, number>;
    excludedIds: Set<string>;
    excludedVideoIds?: Set<string>;
    allowClothing: boolean;
    requireMinDuration?: number;
    requireMinOverlap?: number;
    rejectClimateMismatch?: boolean;
    rejectCloudsIntent?: "decorative" | "overcast" | null;
    /** Scene mood (`calm` / `cheerful` / `dramatic` / …). When set, candidates
     * whose tags or description contain a tonal opposite from
     * `MOOD_INCOMPATIBLE` are rejected before scoring. */
    mood?: string | null;
    /** Scene's inferred concepts (weather / season_mood / scene_fit). When
     * set, candidates whose `concepts.avoid_for` intersects the scene's
     * concept bag are rejected. Structural — uses the catalog's authored
     * "do not use for X" annotations instead of keyword heuristics. */
    sceneConcepts?: SegmentConcepts | null;
  },
): [Candidate | null, number] {
  const {
    targetText: tText,
    usedCounts,
    excludedIds,
    excludedVideoIds,
    allowClothing,
    requireMinDuration = 0,
    requireMinOverlap = 0,
    rejectClimateMismatch = false,
    rejectCloudsIntent = null,
    mood = null,
    sceneConcepts = null,
  } = opts;

  const targetLower = (tText ?? "").toLowerCase();
  const cache = buildBm25Cache(candidates);
  let best: Candidate | null = null;
  let bestScore = -1;
  let bestOverlap = 0;
  let bestUsed: number | null = null;

  for (const [candId, candSeg, candClip] of candidates) {
    if (excludedIds.has(candId)) continue;
    const vid = candClip.id;
    if (vid != null && vid !== "" && excludedVideoIds?.has(String(vid))) continue;
    const used = usedCounts[candId] ?? 0;
    if (used >= MAX_REPEATS) continue;
    const candWords = entryTagWords(candSeg, candClip);
    if (!allowClothing && candWords.some((t) => isClothingTag(t))) continue;
    if (requireMinDuration > 0 && segmentDuration(candSeg) < requireMinDuration) continue;
    if (rejectClimateMismatch) {
      const candVisual = segmentVisualText(candSeg, candClip);
      if (clothingClimateMismatch(tText ?? "", candVisual)) continue;
    }
    if (rejectCloudsIntent != null) {
      const intent = cloudsIntent(candWords);
      if (intent === rejectCloudsIntent) continue;
    }
    if (targetContradictsSegment(tText ?? "", candSeg)) continue;
    // Hard categorical polarity check — tag-first, English+Hebrew aware. Stops
    // snow-for-heat and calm-sunset-for-dangerous-waves regressions that the
    // description-based check above misses when tags are English-only.
    if (weatherClassMismatch(tText ?? "", candSeg)) continue;
    if (sceneAvoidsSegment(sceneConcepts, candSeg)) continue;
    if (moodIsIncompatible(mood, candSeg, candClip)) continue;
    // Gating threshold stays the *integer* tag-hit count so the existing
    // `MIN_SWAP_TAG_OVERLAP=2` semantics carry over. Ranking among the
    // passing set uses BM25 to fix junk-tag amplification.
    const overlapCount = rawOverlapCount(targetLower, candId, cache);
    if (overlapCount < requireMinOverlap) continue;
    const score = bm25Score(targetLower, candId, cache);
    const better =
      score > bestScore || (score === bestScore && (bestUsed === null || used < bestUsed));
    if (better) {
      bestScore = score;
      bestOverlap = overlapCount;
      bestUsed = used;
      best = [candId, candSeg, candClip];
    }
  }
  // Return the integer overlap (not the BM25 score) so callers keep formatting
  // `חפיפת תגיות=N` messages correctly.
  return [best, best ? bestOverlap : -1];
}

function bestLegacyCandidate(
  catalog: CatalogClip[],
  opts: {
    targetText: string;
    usedCounts: Record<string, number>;
    excludedIds: Set<string>;
    excludedVideoIds?: Set<string>;
    allowClothing: boolean;
    requireMinOverlap?: number;
    /** Scene mood for the legacy whole-clip path. Honoured by the same
     * `MOOD_INCOMPATIBLE` table as the segment path. */
    mood?: string | null;
    /** Scene's inferred concepts; reject candidates whose `avoid_for`
     * intersects the scene bag. The legacy path has clip-level concepts
     * only when the catalog put them on the parent clip; that's rare but
     * still worth honouring when present. */
    sceneConcepts?: SegmentConcepts | null;
  },
): [CatalogClip | null, number] {
  const {
    targetText: tText,
    usedCounts,
    excludedIds,
    excludedVideoIds,
    allowClothing,
    requireMinOverlap = 0,
    mood = null,
    sceneConcepts = null,
  } = opts;
  const targetLower = (tText ?? "").toLowerCase();
  // Build a BM25 cache over whole-clip catalog rows so junk-tag clips don't
  // dominate the legacy path either. Treat each row as a candidate keyed by
  // its video id with an empty SegmentEntry — `entryTagWords` falls through
  // to `videoTagWords` when the segment is null.
  const candidates: Candidate[] = catalog
    .filter((c) => !!c.id)
    .map((c) => [String(c.id), {} as SegmentEntry, c]);
  const cache = buildBm25Cache(candidates);
  let best: CatalogClip | null = null;
  let bestScore = -1;
  let bestOverlap = 0;
  let bestUsed: number | null = null;

  for (const cand of catalog) {
    const cid = cand.id;
    if (!cid || excludedIds.has(cid)) continue;
    if (excludedVideoIds?.has(String(cid))) continue;
    const used = usedCounts[cid] ?? 0;
    if (used >= MAX_REPEATS) continue;
    const tags = (cand.tags as Record<string, string>) ?? {};
    const main = tags.main ?? "";
    if (!allowClothing && isClothingTag(main)) continue;
    if (moodIsIncompatible(mood, {} as SegmentEntry, cand)) continue;
    // Whole-clip catalogs rarely carry concepts; honour them when present.
    if (sceneAvoidsSegment(sceneConcepts, cand as { concepts?: SegmentConcepts })) continue;
    // Same categorical polarity gate as the segment path.
    if (weatherClassMismatch(tText ?? "", cand as { tags?: string[] | Record<string, string>; concepts?: SegmentConcepts; description?: string })) continue;
    const overlapCount = rawOverlapCount(targetLower, String(cid), cache);
    if (overlapCount < requireMinOverlap) continue;
    const score = bm25Score(targetLower, String(cid), cache);
    const better =
      score > bestScore || (score === bestScore && (bestUsed === null || used < bestUsed));
    if (better) {
      bestScore = score;
      bestOverlap = overlapCount;
      bestUsed = used;
      best = cand;
    }
  }
  return [best, best ? bestOverlap : -1];
}

// ---------------------------------------------------------------------------
// Swap helpers
// ---------------------------------------------------------------------------

function swapPickToSegment(
  clip: MutablePick,
  newSegId: string,
  newSegment: SegmentEntry,
  newClip: CatalogClip,
  swapReason?: string,
): void {
  const aLen = audioLen(clip);
  const segStart = safeFloat(newSegment.start_sec);
  const segEnd = safeFloat(newSegment.end_sec);
  const srcDur = safeFloat(newClip.duration_sec);
  const maxEnd = srcDur ? Math.min(segEnd, srcDur) : segEnd;
  clip.segment_id = newSegId;
  clip.video_id = newClip.id;
  clip.video_start = segStart;
  clip.video_end = aLen > 0 ? Math.min(maxEnd, segStart + aLen) : maxEnd;
  if (swapReason) {
    clip.reason = swapReason;
    delete clip.picker_reason;
    clip.fallback_reason = validatorEditorialReason(newSegment, newClip);
  }
}

function applyLegacySwap(clip: MutablePick, best: CatalogClip, swapReason?: string): void {
  clip.video_id = best.id;
  clip.video_start = 0.0;
  clip.video_end = Math.min(safeFloat(best.duration_sec), audioLen(clip));
  delete clip.segment_id;
  if (swapReason) {
    clip.reason = swapReason;
    delete clip.picker_reason;
    clip.fallback_reason = validatorEditorialReason(null, best);
  }
}

// ---------------------------------------------------------------------------
// _resolvePicks
// ---------------------------------------------------------------------------

function resolvePicks(
  timeline: MutablePick[],
  segmentMap: Record<string, SegmentMapEntry>,
): Record<string, unknown>[] {
  const warnings: Record<string, unknown>[] = [];
  if (!segmentMap || !Object.keys(segmentMap).length) return warnings;

  for (const clip of timeline) {
    const segId = clip.segment_id;
    if (segId && segmentMap[segId]) {
      const entry = segmentMap[segId];
      const parent = entry.clip;
      const seg = entry.segment;
      clip.video_id = parent.id;
      const segStart = safeFloat(seg.start_sec);
      const segEnd = safeFloat(seg.end_sec);
      const aLen = safeFloat(clip.audio_end) - safeFloat(clip.audio_start);
      const vsRaw = clip.video_start;
      const veRaw = clip.video_end;
      const needDefault =
        vsRaw == null || veRaw == null || safeFloat(veRaw) <= safeFloat(vsRaw);
      if (needDefault) {
        clip.video_start = segStart;
        clip.video_end = aLen > 0 ? Math.min(segEnd, segStart + aLen) : segEnd;
      }
    } else if (segId) {
      warnings.push({ issue: "unknown segment_id", segment_id: segId, video_id: clip.video_id });
    } else if (clip.video_id) {
      const vidId = clip.video_id;
      const candidates = Object.entries(segmentMap)
        .filter(([, e]) => e.clip.id === vidId)
        .map(([sid]) => sid);
      if (candidates.length === 1) clip.segment_id = candidates[0];
    }
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// _enforceClothingRule
// ---------------------------------------------------------------------------

function enforceClothingRule(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  catalog: CatalogClip[],
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const fixes: Record<string, unknown>[] = [];
  let usedCounts = tally(timeline.map((c) => pickKey(c)));
  const candidates = segmentCandidates(segmentMap);

  for (const clip of timeline) {
    const segId = clip.segment_id;
    let tagWords: string[];
    let segVisual: string;

    if (segId && segmentMap[segId]) {
      const entry = segmentMap[segId];
      tagWords = entryTagWords(entry.segment, entry.clip);
      segVisual = segmentVisualText(entry.segment, entry.clip);
    } else {
      const video = videoMap[clip.video_id ?? ""] ?? {};
      tagWords = videoTagWords(video);
      segVisual = [String(video.description ?? ""), ...tagWords].join(" ");
    }

    const clipHasClothingTag = tagWords.some((t) => isClothingTag(t));
    const clipDepictsGarment = isClothingText(segVisual);
    if (!clipHasClothingTag && !clipDepictsGarment) continue;

    const target = targetText(clip, beatsByIdx, scenesByIdx);
    const beatIsClothing = !!target && isClothingText(target);
    const climateMismatch = clothingClimateMismatch(target ?? "", segVisual);

    let issueLabel: string;
    let swapReasonPrefix: string;
    if (climateMismatch) {
      issueLabel = "clothing climate mismatch";
      swapReasonPrefix = "validator: כלל אקלים-ביגוד";
    } else if (!beatIsClothing) {
      issueLabel = "clothing tag on non-wardrobe beat";
      swapReasonPrefix = "validator: כלל ביגוד";
    } else {
      continue;
    }

    const aLen = audioLen(clip);
    let best: Candidate | null = null;
    let bestOverlap = -1;

    if (candidates.length) {
      [best, bestOverlap] = bestCandidateByOverlap(candidates, {
        targetText: target,
        usedCounts,
        excludedIds: new Set([segId ?? ""]),
        allowClothing: false,
        rejectClimateMismatch: true,
        requireMinDuration: aLen,
        requireMinOverlap: candidates.length ? MIN_SWAP_TAG_OVERLAP : 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
    } else {
      const [legacyBest, legacyOverlap] = bestLegacyCandidate(catalog, {
        targetText: target,
        usedCounts,
        excludedIds: new Set([clip.video_id ?? ""]),
        allowClothing: false,
        requireMinOverlap: candidates.length ? MIN_SWAP_TAG_OVERLAP : 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (legacyBest) {
        applyLegacySwap(clip, legacyBest, `${swapReasonPrefix} — הוחלף מ-${segId ?? clip.video_id} (חפיפת תגיות=${legacyOverlap})`);
        usedCounts = tally(timeline.map((c) => pickKey(c)));
        fixes.push({ issue: issueLabel, original: segId ?? clip.video_id, swapped_to: legacyBest.id, swap_reason: `climate-aware alternative; tag overlap=${legacyOverlap}`, fixed: true });
        continue;
      }
    }

    if (best === null) {
      fixes.push({ issue: issueLabel, segment_id: segId, video_id: clip.video_id, swap_reason: `no acceptable replacement covering ${aLen.toFixed(1)}s`, fixed: false });
      continue;
    }

    const original = segId ?? clip.video_id;
    const swapReasonText = `${swapReasonPrefix} — הוחלף מ-${original} (חפיפת תגיות=${bestOverlap})`;
    const [newSegId, newSeg, newClip] = best;
    swapPickToSegment(clip, newSegId, newSeg, newClip, swapReasonText);
    usedCounts = tally(timeline.map((c) => pickKey(c)));
    fixes.push({ issue: issueLabel, original, swapped_to: newSegId, swap_reason: `climate-aware alternative; tag overlap=${bestOverlap}`, fixed: true });
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// _enforceSemanticFit
// ---------------------------------------------------------------------------

function enforceSemanticFit(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const fixes: Record<string, unknown>[] = [];
  if (!segmentMap || !Object.keys(segmentMap).length) return fixes;

  const candidates = segmentCandidates(segmentMap);
  let usedCounts = tally(timeline.map((c) => pickKey(c)));

  for (const clip of timeline) {
    const segId = clip.segment_id;
    if (!segId || !segmentMap[segId]) continue;

    const target = targetText(clip, beatsByIdx, scenesByIdx);
    if (!target) continue;
    // Trigger a swap on EITHER the description-based contradict signal OR the
    // tag-first categorical polarity check (weatherClassMismatch). Without
    // the latter, snow-for-heat and dusk-for-midday picks slip through
    // because targetContradictsSegment misses English-tagged segments.
    const seg = segmentMap[segId].segment;
    if (!targetContradictsSegment(target, seg) && !weatherClassMismatch(target, seg)) continue;

    const aLen = audioLen(clip);
    const [best, bestOverlap] = bestCandidateByOverlap(candidates, {
      targetText: target,
      usedCounts,
      excludedIds: new Set([segId]),
      allowClothing: isClothingText(target),
      requireMinDuration: aLen,
      requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
      ...semanticFloorFor(clip, scenesByIdx),
    });

    if (!best) {
      fixes.push({
        issue: "semantic mismatch",
        segment_id: segId,
        swap_reason: `no semantically valid replacement covering ${aLen.toFixed(1)}s`,
        fixed: false,
      });
      continue;
    }

    const [newSegId, newSeg, newClip] = best;
    swapPickToSegment(
      clip,
      newSegId,
      newSeg,
      newClip,
      `validator: התאמה סמנטית — הוחלף מ-${segId} (חפיפת תגיות=${bestOverlap})`,
    );
    usedCounts = tally(timeline.map((c) => pickKey(c)));
    fixes.push({
      issue: "semantic mismatch",
      original: segId,
      swapped_to: newSegId,
      swap_reason: `target weather/concept contradiction; overlap=${bestOverlap}`,
      fixed: true,
    });
  }

  return fixes;
}

// ---------------------------------------------------------------------------
// _enforceAntiClipReuse (parent file / video_id)
// ---------------------------------------------------------------------------

function enforceAntiClipReuse(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  catalog: CatalogClip[],
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const fixes: Record<string, unknown>[] = [];
  if (!Object.keys(segmentMap).length) return fixes;

  const candidates = segmentCandidates(segmentMap);
  const maxIter = Math.max(12, timeline.length * 4);

  for (let iter = 0; iter < maxIter; iter++) {
    const byVid: Record<string, number[]> = {};
    for (let i = 0; i < timeline.length; i++) {
      const v = timeline[i].video_id;
      if (!v) continue;
      (byVid[v] ??= []).push(i);
    }

    let swapIndex: number | null = null;
    let swapVideoId: string | null = null;

    for (const [vid, rawIdx] of Object.entries(byVid)) {
      const idxs = [...rawIdx].sort((a, b) => a - b);
      if (idxs.length < 2) continue;

      if (idxs.length > SAME_CLIP_MAX_PICKS) {
        swapIndex = idxs[idxs.length - 1];
        swapVideoId = vid;
        break;
      }

      const c0 = timeline[idxs[0]];
      const c1 = timeline[idxs[1]];
      const sid0 = c0.segment_id;
      const sid1 = c1.segment_id;
      if (!sid0 || !sid1 || !segmentMap[sid0] || !segmentMap[sid1]) {
        swapIndex = idxs[1];
        swapVideoId = vid;
        break;
      }
      const s0 = segmentMap[sid0].segment;
      const s1 = segmentMap[sid1].segment;
      if (!sameClipReuseAllowed(s0, s1)) {
        swapIndex = idxs[1];
        swapVideoId = vid;
        break;
      }
    }

    if (swapIndex == null || swapVideoId == null) break;

    const clip = timeline[swapIndex];
    const key = pickKey(clip);
    const target = targetText(clip, beatsByIdx, scenesByIdx);
    const beatIsClothing = isClothingText(target);
    const aLen = audioLen(clip);
    const counts = tally(timeline.map((c) => pickKey(c)));
    let didSwap = false;
    if (candidates.length) {
      const [best, bestOverlap] = bestCandidateByOverlap(candidates, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set(key ? [key] : []),
        excludedVideoIds: new Set([swapVideoId]),
        allowClothing: beatIsClothing,
        requireMinDuration: aLen,
        requireMinOverlap: candidates.length ? MIN_SWAP_TAG_OVERLAP : 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (best) {
        const [newSegId, newSeg, newClip] = best;
        swapPickToSegment(
          clip,
          newSegId,
          newSeg,
          newClip,
          `validator: אותו קובץ מקור — הוחלף מ-${swapVideoId} (חפיפת תגיות=${bestOverlap})`,
        );
        fixes.push({
          issue: "same clip reuse",
          video_id: swapVideoId,
          swapped_to: newSegId,
          swap_reason: `tag overlap=${bestOverlap}`,
          fixed: true,
        });
        didSwap = true;
      }
    }
    if (!didSwap) {
      const [legacyBest, legacyOverlap] = bestLegacyCandidate(catalog, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set(key ? [key] : []),
        excludedVideoIds: new Set([swapVideoId]),
        allowClothing: beatIsClothing,
        requireMinOverlap: candidates.length ? MIN_SWAP_TAG_OVERLAP : 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (legacyBest) {
        applyLegacySwap(
          clip,
          legacyBest,
          `validator: אותו קובץ מקור — הוחלף מ-${swapVideoId} (חפיפת תגיות=${legacyOverlap})`,
        );
        fixes.push({
          issue: "same clip reuse",
          video_id: swapVideoId,
          swapped_to: legacyBest.id,
          swap_reason: `tag overlap=${legacyOverlap}`,
          fixed: true,
        });
        didSwap = true;
      }
    }
    if (!didSwap) {
      fixes.push({
        issue: "same clip reuse",
        video_id: swapVideoId,
        segment_id: key,
        swap_reason: `no replacement ≥ ${aLen.toFixed(1)}s; kept`,
        fixed: false,
      });
      break;
    }
  }

  return fixes;
}

// ---------------------------------------------------------------------------
// _enforceAntiRepeat
// ---------------------------------------------------------------------------

function enforceAntiRepeat(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  catalog: CatalogClip[],
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const fixes: Record<string, unknown>[] = [];
  let counts = tally(timeline.map((c) => pickKey(c)));
  const candidates = segmentCandidates(segmentMap);

  for (let i = 0; i < timeline.length; i++) {
    const clip = timeline[i];
    const key = pickKey(clip);
    if (!key || (counts[key] ?? 0) <= MAX_REPEATS) continue;
    const positions = timeline.reduce<number[]>((acc, c, j) => {
      if (pickKey(c) === key) acc.push(j);
      return acc;
    }, []);
    if (!positions.slice(MAX_REPEATS).includes(i)) continue;

    const target = targetText(clip, beatsByIdx, scenesByIdx);
    const beatIsClothing = isClothingText(target);
    const aLen = audioLen(clip);

    let swappedTo: string | undefined;
    if (candidates.length) {
      const [best, bestOverlap] = bestCandidateByOverlap(candidates, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set([key]),
        allowClothing: beatIsClothing,
        requireMinDuration: aLen,
        requireMinOverlap: candidates.length ? MIN_SWAP_TAG_OVERLAP : 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (best) {
        const [newSegId, newSeg, newClip] = best;
        swapPickToSegment(clip, newSegId, newSeg, newClip, `validator: חזרה — הוחלף מ-${key} (חפיפת תגיות=${bestOverlap})`);
        swappedTo = newSegId;
        counts = tally(timeline.map((c) => pickKey(c)));
        fixes.push({ issue: `${(counts[key] ?? 0) + 1}th repeat`, original: key, swapped_to: swappedTo, swap_reason: `tag overlap=${bestOverlap}`, fixed: true });
        continue;
      }
    } else {
      const [legacyBest, legacyOverlap] = bestLegacyCandidate(catalog, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set([key]),
        allowClothing: beatIsClothing,
        requireMinOverlap: 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (legacyBest) {
        applyLegacySwap(clip, legacyBest, `validator: חזרה — הוחלף מ-${key} (חפיפת תגיות=${legacyOverlap})`);
        counts = tally(timeline.map((c) => pickKey(c)));
        fixes.push({ issue: `${(counts[key] ?? 0) + 1}th repeat`, original: key, swapped_to: legacyBest.id, swap_reason: `tag overlap=${legacyOverlap}`, fixed: true });
        continue;
      }
    }
    fixes.push({ issue: `${counts[key]}th repeat`, segment_id: key, swap_reason: `no replacement ≥ ${aLen.toFixed(1)}s; kept`, fixed: false });
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// _enforceAntiConsecutive
// ---------------------------------------------------------------------------

function enforceAntiConsecutive(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  catalog: CatalogClip[],
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const fixes: Record<string, unknown>[] = [];
  let counts = tally(timeline.map((c) => pickKey(c)));
  const candidates = segmentCandidates(segmentMap);

  for (let i = 1; i < timeline.length; i++) {
    const prev = pickKey(timeline[i - 1]);
    const cur = pickKey(timeline[i]);
    if (!prev || prev !== cur) continue;

    const target = targetText(timeline[i], beatsByIdx, scenesByIdx);
    const beatIsClothing = isClothingText(target);
    const aLen = audioLen(timeline[i]);

    if (candidates.length) {
      const [best, bestOverlap] = bestCandidateByOverlap(candidates, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set([prev]),
        allowClothing: beatIsClothing,
        requireMinDuration: aLen,
        requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
        ...semanticFloorFor(timeline[i], scenesByIdx),
      });
      if (best) {
        const [newSegId, newSeg, newClip] = best;
        swapPickToSegment(timeline[i], newSegId, newSeg, newClip, `validator: רצף — הוחלף מ-${prev} (חפיפת תגיות=${bestOverlap})`);
        counts = tally(timeline.map((c) => pickKey(c)));
        fixes.push({ issue: "consecutive duplicate", original: prev, swapped_to: newSegId, swap_reason: `tag overlap=${bestOverlap}`, fixed: true });
        continue;
      }
    } else {
      const [legacyBest, legacyOverlap] = bestLegacyCandidate(catalog, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set([prev]),
        allowClothing: beatIsClothing,
        requireMinOverlap: 0,
        ...semanticFloorFor(timeline[i], scenesByIdx),
      });
      if (legacyBest) {
        applyLegacySwap(timeline[i], legacyBest, `validator: רצף — הוחלף מ-${prev} (חפיפת תגיות=${legacyOverlap})`);
        counts = tally(timeline.map((c) => pickKey(c)));
        fixes.push({ issue: "consecutive duplicate", original: prev, swapped_to: legacyBest.id, swap_reason: `tag overlap=${legacyOverlap}`, fixed: true });
        continue;
      }
    }
    fixes.push({ issue: "consecutive duplicate", segment_id: cur, swap_reason: `no replacement ≥ ${aLen.toFixed(1)}s; kept`, fixed: false });
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// _enforceRecency
// ---------------------------------------------------------------------------

function enforceRecency(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  catalog: CatalogClip[],
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = [];
  if (!timeline.length) return results;

  let counts = tally(timeline.map((c) => pickKey(c)));
  const candidates = segmentCandidates(segmentMap);
  const lastSeen: Record<string, number> = {};

  for (let i = 0; i < timeline.length; i++) {
    const clip = timeline[i];
    const key = pickKey(clip);
    if (!key) continue;
    const sidx = clip.scene_idx ?? null;
    if (sidx === null) {
      if (!(key in lastSeen)) lastSeen[key] = i;
      continue;
    }
    const prevScene = lastSeen[key] ?? null;
    if (prevScene === null || sidx === prevScene) {
      lastSeen[key] = sidx;
      continue;
    }
    if (sidx - prevScene > RECENCY_WINDOW_SCENES) {
      lastSeen[key] = sidx;
      continue;
    }

    const target = targetText(clip, beatsByIdx, scenesByIdx);
    const beatIsClothing = isClothingText(target);
    const aLen = audioLen(clip);

    let swappedTo: string | undefined;
    let swapped = false;

    if (candidates.length) {
      const [best, bestOverlap] = bestCandidateByOverlap(candidates, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set([key]),
        allowClothing: beatIsClothing,
        requireMinDuration: aLen,
        requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (best) {
        const [newSegId, newSeg, newClip] = best;
        swapPickToSegment(clip, newSegId, newSeg, newClip, `validator: שימוש חוזר קרוב — הוחלף מ-${key} (סצנה ${prevScene}→${sidx}, חפיפת תגיות=${bestOverlap})`);
        swappedTo = newSegId;
        counts = tally(timeline.map((c) => pickKey(c)));
        results.push({ issue: "recency violation", original: key, swapped_to: swappedTo, previous_scene: prevScene, current_scene: sidx, window: RECENCY_WINDOW_SCENES, swap_reason: `tag overlap=${bestOverlap}`, fixed: true });
        delete lastSeen[key];
        lastSeen[swappedTo] = sidx;
        swapped = true;
      }
    } else {
      const [legacyBest, legacyOverlap] = bestLegacyCandidate(catalog, {
        targetText: target,
        usedCounts: counts,
        excludedIds: new Set([key]),
        allowClothing: beatIsClothing,
        requireMinOverlap: 0,
        ...semanticFloorFor(clip, scenesByIdx),
      });
      if (legacyBest) {
        applyLegacySwap(clip, legacyBest, `validator: שימוש חוזר קרוב — הוחלף מ-${key} (סצנה ${prevScene}→${sidx}, חפיפת תגיות=${legacyOverlap})`);
        swappedTo = legacyBest.id;
        counts = tally(timeline.map((c) => pickKey(c)));
        results.push({ issue: "recency violation", original: key, swapped_to: swappedTo, previous_scene: prevScene, current_scene: sidx, window: RECENCY_WINDOW_SCENES, swap_reason: `tag overlap=${legacyOverlap}`, fixed: true });
        delete lastSeen[key];
        lastSeen[swappedTo!] = sidx;
        swapped = true;
      }
    }

    if (!swapped) {
      results.push({ issue: "recency violation", segment_id: key, previous_scene: prevScene, current_scene: sidx, window: RECENCY_WINDOW_SCENES, swap_reason: `no alternative ≥ ${aLen.toFixed(1)}s; kept`, fixed: false });
      lastSeen[key] = sidx;
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// _enforceCoverage
// ---------------------------------------------------------------------------

function enforceCoverage(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const fixes: Record<string, unknown>[] = [];
  if (!segmentMap || !Object.keys(segmentMap).length) return fixes;

  const candidates = segmentCandidates(segmentMap);
  const inserts: [number, MutablePick][] = [];

  for (let i = 0; i < timeline.length; i++) {
    const clip = timeline[i];
    const aLen = audioLen(clip);
    const vLen = videoLen(clip);
    const gap = aLen - vLen;
    if (gap <= COVERAGE_GAP_TOLERANCE) continue;

    const segId = clip.segment_id;
    const target = targetText(clip, beatsByIdx, scenesByIdx);
    const targetLower = target.toLowerCase();
    const beatIsClothing = isClothingText(target);
    const rejectClimate = beatIsClothing && (isHotWeatherNarration(target) || isColdWeatherNarration(target));
    const rejectClouds: "decorative" | "overcast" | null = isOvercastNarration(target)
      ? "decorative"
      : isHotWeatherNarration(target)
        ? "overcast"
        : null;
    const usedCounts = tally(timeline.map((c) => pickKey(c)));
    const floor = semanticFloorFor(clip, scenesByIdx);

    // Strategy 1: swap to a longer same-theme segment — but only when the
    // swap candidate's BM25 score beats the original picker's pick by
    // SWAP_MARGIN_FRACTION. A tag-only re-rank that barely improves on the
    // LLM's narrative pick isn't worth discarding it.
    const [best, overlap] = bestCandidateByOverlap(candidates, {
      targetText: target,
      usedCounts,
      excludedIds: new Set([segId ?? ""]),
      allowClothing: beatIsClothing,
      requireMinDuration: aLen,
      requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
      rejectClimateMismatch: rejectClimate,
      rejectCloudsIntent: rejectClouds,
      ...floor,
    });

    if (best) {
      const [newSegId, newSeg, newClip] = best;
      // Compute both scores against a unified BM25 index so the comparison is
      // apples-to-apples. We include the original pick so its score is
      // present even if it sat outside the candidate set above.
      const coverageCandidates: Candidate[] = (() => {
        if (!segId || segId === newSegId) return [...candidates, best];
        const origEntry = segmentMap[segId];
        if (!origEntry) return [...candidates, best];
        return [...candidates, best, [segId, origEntry.segment, origEntry.clip] as Candidate];
      })();
      const scoreCache = buildBm25Cache(coverageCandidates);
      const originalScore = segId ? bm25Score(targetLower, segId, scoreCache) : 0;
      const swapScore = bm25Score(targetLower, newSegId, scoreCache);
      const meetsMargin =
        originalScore <= 0
          ? true
          : swapScore >= originalScore * (1 + SWAP_MARGIN_FRACTION);

      if (meetsMargin) {
        swapPickToSegment(clip, newSegId, newSeg, newClip, `validator: כיסוי — הוחלף מ-${segId} (${gap.toFixed(1)}s חוסר, חפיפת תגיות=${overlap})`);
        fixes.push({ issue: "coverage gap", original: segId, swapped_to: newSegId, swap_reason: `longer segment; gap=${gap.toFixed(2)}s, tag overlap=${overlap}, bm25=${swapScore.toFixed(2)}>${originalScore.toFixed(2)}`, fixed: true });
        continue;
      }
      // Margin not met → fall through to split. The original pick stays as
      // the head of the scene, a residual covers the remainder.
    }

    // Strategy 2: split — keep the original (semantically vetted) pick and
    // add a residual segment for the uncovered tail.
    const residualAudioStart = safeFloat(clip.audio_start) + vLen;
    const residualAudioEnd = safeFloat(clip.audio_end);
    const residualLen = residualAudioEnd - residualAudioStart;
    if (residualLen <= 0) continue;

    clip.audio_end = residualAudioStart;

    let [residualBest, residualOverlap] = bestCandidateByOverlap(candidates, {
      targetText: target,
      usedCounts,
      excludedIds: new Set([segId ?? "", pickKey(clip)]),
      allowClothing: beatIsClothing,
      requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
      rejectClimateMismatch: rejectClimate,
      rejectCloudsIntent: rejectClouds,
      ...floor,
    });

    if (!residualBest) {
      [residualBest, residualOverlap] = bestCandidateByOverlap(candidates, {
        targetText: target,
        usedCounts,
        excludedIds: new Set([segId ?? "", pickKey(clip)]),
        allowClothing: beatIsClothing,
        rejectClimateMismatch: rejectClimate,
        rejectCloudsIntent: rejectClouds,
        requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
        ...floor,
      });
    }

    if (!residualBest) {
      fixes.push({ issue: "coverage gap", segment_id: segId, swap_reason: "no longer or residual candidate; left as warning", fixed: false });
      clip.audio_end = residualAudioEnd;
      continue;
    }

    const [newSegId, newSeg, newClip] = residualBest;
    const newSegStart = safeFloat(newSeg.start_sec);
    const newSegEnd = safeFloat(newSeg.end_sec);
    const residualPick: MutablePick = {
      scene_idx: clip.scene_idx,
      segment_id: newSegId,
      video_id: newClip.id,
      audio_start: Math.round(residualAudioStart * 100) / 100,
      audio_end: Math.round(residualAudioEnd * 100) / 100,
      video_start: newSegStart,
      video_end: Math.min(newSegEnd, newSegStart + residualLen),
      reason: `validator: מילוי כיסוי ל-${segId} (${residualLen.toFixed(1)}s, חפיפת תגיות=${residualOverlap})`,
      fallback_reason: validatorEditorialReason(newSeg, newClip, "נבחר להשלמת משך הסצינה"),
    };
    inserts.push([i + 1, residualPick]);
    fixes.push({ issue: "coverage gap", original: segId, split_residual_to: newSegId, swap_reason: `split: original ${vLen.toFixed(1)}s + residual ${residualLen.toFixed(1)}s (overlap=${residualOverlap})`, fixed: true });
  }

  // Apply inserts in reverse
  for (const [atIdx, pick] of [...inserts].reverse()) {
    timeline.splice(atIdx, 0, pick);
  }
  return fixes;
}

// ---------------------------------------------------------------------------
// _mergeShortClips
// ---------------------------------------------------------------------------

function betterNeighborIndex(
  timeline: MutablePick[],
  i: number,
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  segmentMap: Record<string, SegmentMapEntry>,
): number | null {
  const candidates: number[] = [];
  if (i - 1 >= 0) candidates.push(i - 1);
  if (i + 1 < timeline.length) candidates.push(i + 1);
  if (!candidates.length) return null;
  if (candidates.length === 1) return candidates[0];

  const score = (j: number): number => {
    const nb = timeline[j];
    const beat = nb.beat_idx != null ? beatsByIdx[nb.beat_idx] : null;
    if (!beat) return 0;
    const beatText2 = (beat.text ?? "").toLowerCase();
    const words = entryTagWordsForPick(nb, segmentMap, videoMap);
    return words.reduce((sum, w) => (w && beatText2.includes(w.toLowerCase()) ? sum + 1 : sum), 0);
  };

  return candidates.reduce((best, c) => (score(c) >= score(best) ? c : best), candidates[0]);
}

function mergeShortClips(
  timeline: MutablePick[],
  beatsByIdx: Record<number, WhisperBeat>,
  videoMap: Record<string, CatalogClip>,
  segmentMap: Record<string, SegmentMapEntry>,
  scenesByIdx: Record<number, SceneDict>,
): Record<string, unknown>[] {
  const merges: Record<string, unknown>[] = [];
  let i = 0;
  while (i < timeline.length) {
    const clip = timeline[i];
    if (audioLen(clip) >= MIN_CLIP_DURATION) {
      i++;
      continue;
    }
    // Preserve intentional per-region picks on heterogeneous scenes
    const sidx = clip.scene_idx;
    if (sidx != null && scenesByIdx[sidx]?.heterogeneous) {
      i++;
      continue;
    }
    const j = betterNeighborIndex(timeline, i, beatsByIdx, videoMap, segmentMap);
    if (j === null) {
      i++;
      continue;
    }
    const nb = timeline[j];
    const newStart = Math.min(nb.audio_start, clip.audio_start);
    const newEnd = Math.max(nb.audio_end, clip.audio_end);
    nb.audio_start = newStart;
    nb.audio_end = newEnd;

    const vid = videoMap[nb.video_id ?? ""] ?? {};
    const maxSrc = safeFloat(vid.duration_sec);
    const nbSegId = nb.segment_id;
    let maxForPick = maxSrc;
    let minForPick = 0.0;
    if (nbSegId && segmentMap[nbSegId]) {
      const seg = segmentMap[nbSegId].segment;
      const segEnd = safeFloat(seg.end_sec) || maxSrc;
      const segStart = safeFloat(seg.start_sec);
      maxForPick = maxSrc ? Math.min(segEnd, maxSrc) : segEnd;
      minForPick = segStart;
    }

    nb.video_start = safeFloat(nb.video_start ?? minForPick);
    nb.video_end = nb.video_start + (newEnd - newStart);
    if (maxForPick && nb.video_end > maxForPick) {
      nb.video_end = maxForPick;
      nb.video_start = Math.max(minForPick, maxForPick - (newEnd - newStart));
    }

    merges.push({
      merged_index: i,
      absorbed_into: j < i ? j : j - 1,
      absorbed_segment_id: clip.segment_id ?? clip.video_id,
      kept_segment_id: nb.segment_id ?? nb.video_id,
      reason: `clip < ${MIN_CLIP_DURATION}s merged into neighbor`,
    });
    timeline.splice(i, 1);
    if (i > 0) i = Math.max(0, i - 1);
  }
  return merges;
}

// ---------------------------------------------------------------------------
// _flagThematicAdjacency
// ---------------------------------------------------------------------------

// Tags that are too generic to drive a useful "thematic adjacency" warning.
// A forecast where every clip is `יום` / `בהיר` / `טבע` is not a thematic
// adjacency problem — it's just daytime weather B-roll. These stopwords
// caused 9-deep false positives on every analysed plan; filtering them out
// keeps the rule honest about real repetition (e.g. 4 sea shots in a row).
const ADJACENCY_STOPWORDS = new Set<string>([
  // Hebrew generic
  "יום", "לילה", "בהיר", "טבע", "עיר", "עירוני", "ים", "מזג אוויר",
  "רקע כללי", "טמפרטורות", "calm",
  // English equivalents
  "day", "night", "clear_sky", "nature", "urban", "sea", "weather", "general",
]);

function flagThematicAdjacency(
  timeline: MutablePick[],
  videoMap: Record<string, CatalogClip>,
  segmentMap: Record<string, SegmentMapEntry>,
): Record<string, unknown>[] {
  if (timeline.length < THEMATIC_ADJACENCY_RUN_LEN) return [];
  const flags: Record<string, unknown>[] = [];

  const tagSets: Set<string>[] = timeline.map((c) => {
    const words = entryTagWordsForPick(c, segmentMap, videoMap);
    return new Set(
      words
        .map((w) => w.toLowerCase().trim())
        .filter(Boolean)
        .filter((w) => !ADJACENCY_STOPWORDS.has(w)),
    );
  });

  let i = 0;
  while (i < tagSets.length) {
    if (!tagSets[i].size) {
      i++;
      continue;
    }
    let common = new Set(tagSets[i]);
    let end = i + 1;
    while (end < tagSets.length && tagSets[end].size) {
      const nxt = new Set([...common].filter((x) => tagSets[end].has(x)));
      if (!nxt.size) break;
      common = nxt;
      end++;
    }
    const runLen = end - i;
    if (runLen >= THEMATIC_ADJACENCY_RUN_LEN && common.size) {
      const tag = [...common].sort()[0];
      flags.push({
        issue: "thematic adjacency",
        tag,
        run_length: runLen,
        indices: Array.from({ length: runLen }, (_, k) => i + k),
        segment_ids: Array.from({ length: runLen }, (_, k) => pickKey(timeline[i + k])),
      });
      i = end;
    } else {
      i++;
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// _fillSceneGaps
// ---------------------------------------------------------------------------

function fillSceneGaps(
  timeline: MutablePick[],
  scenes: SceneDict[],
  segmentMap: Record<string, SegmentMapEntry>,
  beatsByIdx: Record<number, WhisperBeat>,
): Record<string, unknown>[] {
  if (!scenes?.length || !segmentMap || !Object.keys(segmentMap).length) return [];

  const fills: Record<string, unknown>[] = [];
  const have = new Set(timeline.map((c) => c.scene_idx).filter((x) => x != null));
  const missing = scenes.filter((s) => !have.has(s.idx));
  if (!missing.length) return [];

  const used = tally(timeline.map((c) => pickKey(c)));
  const candidates = segmentCandidates(segmentMap);
  if (!candidates.length) return [];

  for (const scene of missing) {
    const sceneIdx = scene.idx;
    const start = safeFloat(scene.start_sec);
    const end = safeFloat(scene.end_sec) || start;
    if (end <= start) continue;

    const sceneTextStr = ((scene.narration ?? "") + " " + (scene.keywords ?? []).join(" ")).trim();
    const sceneIsClothing = isClothingText(sceneTextStr);
    const sceneHasClimate = isHotWeatherNarration(sceneTextStr) || isColdWeatherNarration(sceneTextStr);

    const [best, bestOverlap] = bestCandidateByOverlap(candidates, {
      targetText: sceneTextStr,
      usedCounts: used,
      excludedIds: new Set(),
      allowClothing: sceneIsClothing,
      rejectClimateMismatch: sceneIsClothing && sceneHasClimate,
      requireMinDuration: end - start,
      requireMinOverlap: MIN_SWAP_TAG_OVERLAP,
      mood: scene.mood ?? null,
      sceneConcepts: inferSceneConcepts(scene),
    });

    if (!best) {
      fills.push({ scene_idx: sceneIdx, issue: "scene has no pick", fixed: false, fill_reason: "no acceptable replacement" });
      continue;
    }

    const [newSegId, newSeg, newClip] = best;
    const segStart = safeFloat(newSeg.start_sec);
    const segEnd = safeFloat(newSeg.end_sec);
    const aLen = end - start;
    const placeholder: MutablePick = {
      scene_idx: sceneIdx,
      segment_id: newSegId,
      video_id: newClip.id,
      audio_start: Math.round(start * 100) / 100,
      audio_end: Math.round(end * 100) / 100,
      video_start: segStart,
      video_end: aLen > 0 ? Math.min(segEnd, segStart + aLen) : segEnd,
      reason: `validator: מילוי אוטומטי לסצנה ${sceneIdx}`,
      fallback_reason: validatorEditorialReason(newSeg, newClip, "נבחר כמילוי אוטומטי לסצינה"),
    };

    let insertAt = timeline.length;
    for (let i = 0; i < timeline.length; i++) {
      if (safeFloat(timeline[i].audio_start) > start) {
        insertAt = i;
        break;
      }
    }
    timeline.splice(insertAt, 0, placeholder);
    used[newSegId] = (used[newSegId] ?? 0) + 1;
    fills.push({ scene_idx: sceneIdx, issue: "scene has no pick", fixed: true, filled_with: newSegId, fill_reason: `tag overlap=${bestOverlap}` });
  }
  return fills;
}

// ---------------------------------------------------------------------------
// Timeline order (concat / UI consistency)
// ---------------------------------------------------------------------------

/** Stable narrative order: matches ffmpeg concat and the Plan card's per-scene sort. */
export function sortTimelineForRender(
  timeline: Array<{
    audio_start?: number;
    audio_end?: number;
    scene_idx?: number | null;
  }>,
): void {
  timeline.sort((a, b) => {
    const cmpStart = safeFloat(a.audio_start) - safeFloat(b.audio_start);
    if (cmpStart !== 0) return cmpStart;
    const cmpEnd = safeFloat(a.audio_end) - safeFloat(b.audio_end);
    if (cmpEnd !== 0) return cmpEnd;
    const ai = a.scene_idx;
    const bi = b.scene_idx;
    const an = ai == null ? Number.POSITIVE_INFINITY : Number(ai);
    const bn = bi == null ? Number.POSITIVE_INFINITY : Number(bi);
    return an - bn;
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function validateAndSwap(
  timeline: MutablePick[],
  opts: {
    beats?: WhisperBeat[];
    videoMap?: Record<string, CatalogClip>;
    segmentMap?: Record<string, SegmentMapEntry>;
    scenes?: SceneDict[];
    allowSceneGapFill?: boolean;
  } = {},
): ValidatorBundle {
  const videoMap = opts.videoMap ?? {};
  const segmentMap = opts.segmentMap ?? {};
  const catalog = Object.values(videoMap);
  const beatsByIdx: Record<number, WhisperBeat> = {};
  for (const b of opts.beats ?? []) {
    if (typeof b.idx === "number") beatsByIdx[b.idx] = b;
  }
  const scenesByIdx: Record<number, SceneDict> = {};
  for (const s of opts.scenes ?? []) {
    if (s.idx != null) scenesByIdx[Number(s.idx)] = s;
  }

  const hardViolationsFixed: Record<string, unknown>[] = [];
  const hardViolationsKept: Record<string, unknown>[] = [];
  const warnings: Record<string, unknown>[] = [];
  const gapFilled: Record<string, unknown>[] = [];

  for (const w of resolvePicks(timeline, segmentMap)) warnings.push(w);

  if (opts.scenes?.length && opts.allowSceneGapFill) {
    for (const fill of fillSceneGaps(timeline, opts.scenes, segmentMap, beatsByIdx)) {
      gapFilled.push(fill);
      warnings.push({
        issue: "automatic scene fill",
        scene_idx: fill.scene_idx,
        segment_id: fill.filled_with,
        message: String(fill.fill_reason ?? ""),
      });
    }
  } else if (opts.scenes?.length) {
    const have = new Set(timeline.map((c) => c.scene_idx).filter((x) => x != null));
    for (const scene of opts.scenes) {
      if (!have.has(scene.idx)) {
        warnings.push({
          issue: "scene has no pick",
          scene_idx: scene.idx,
          message: "Scene gap fill disabled because the picker did not return usable coverage.",
        });
      }
    }
  }

  for (const fix of enforceCoverage(timeline, beatsByIdx, videoMap, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  for (const fix of enforceSemanticFit(timeline, beatsByIdx, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  for (const fix of enforceClothingRule(timeline, beatsByIdx, videoMap, catalog, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  for (const fix of enforceAntiClipReuse(timeline, beatsByIdx, videoMap, catalog, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  for (const fix of enforceAntiRepeat(timeline, beatsByIdx, videoMap, catalog, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  for (const fix of enforceAntiConsecutive(timeline, beatsByIdx, videoMap, catalog, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  for (const result of enforceRecency(timeline, beatsByIdx, videoMap, catalog, segmentMap, scenesByIdx)) {
    if (result.fixed) hardViolationsFixed.push(result);
    else warnings.push(result);
  }

  const merges = mergeShortClips(timeline, beatsByIdx, videoMap, segmentMap, scenesByIdx);
  for (const m of merges) hardViolationsFixed.push({ ...m, issue: "clip too short", fixed: true });

  for (const fix of enforceCoverage(timeline, beatsByIdx, videoMap, segmentMap, scenesByIdx)) {
    (fix.fixed ? hardViolationsFixed : hardViolationsKept).push(fix);
  }

  sortTimelineForRender(timeline);

  for (const flag of flagThematicAdjacency(timeline, videoMap, segmentMap)) warnings.push(flag);

  // Out-of-range source warning
  for (const clip of timeline) {
    const vid = videoMap[clip.video_id ?? ""] ?? {};
    const dur = safeFloat(vid.duration_sec);
    const vs = safeFloat(clip.video_start);
    const ve = safeFloat(clip.video_end);
    if (dur && (vs >= dur || ve > dur + 0.1)) {
      warnings.push({ issue: "source range out of bounds", segment_id: clip.segment_id, video_id: clip.video_id, video_start: vs, video_end: ve, duration: dur });
    }
  }

  // Tagging health
  let catalogHealth: Record<string, unknown>;
  if (Object.keys(segmentMap).length) {
    const totalSegments = Object.keys(segmentMap).length;
    const taggedSegments = Object.values(segmentMap).filter((e) =>
      segmentTagWords(e.segment).some(Boolean),
    ).length;
    const untaggedPicks = timeline.filter(
      (c) => !entryTagWordsForPick(c, segmentMap, videoMap).length,
    ).length;
    catalogHealth = { loaded_clips: catalog.length, loaded_segments: totalSegments, tagged_segments: taggedSegments, untagged_picks: untaggedPicks };
  } else {
    const tagged = catalog.filter((v) => {
      const tags = (v.tags as Record<string, string>) ?? {};
      return tags.main || tags.secondary || tags.third;
    }).length;
    const untaggedPicks = timeline.filter((c) => {
      const vid = videoMap[c.video_id ?? ""] ?? {};
      const tags = (vid.tags as Record<string, string>) ?? {};
      return !tags.main && !tags.secondary && !tags.third;
    }).length;
    catalogHealth = { loaded: catalog.length, tagged, untagged_picks: untaggedPicks };
  }

  const fixedGapCount = gapFilled.filter((g) => g.fixed).length;
  const failedGapCount = gapFilled.filter((g) => !g.fixed).length;
  const score = Math.max(
    0,
    100 - 10 * hardViolationsKept.length - 3 * warnings.length - 8 * fixedGapCount - 12 * failedGapCount,
  );
  // Quality: ignore `score` (under-penalises unfixed hard violations) and
  // categorise on the count of things the validator could not fix at all.
  const unfixed = hardViolationsKept.length + failedGapCount;
  const quality: "ship" | "review" | "replan" =
    unfixed === 0 ? "ship" : unfixed === 1 ? "review" : "replan";
  const out: ValidatorBundle = {
    score,
    quality,
    hard_violations_fixed: hardViolationsFixed,
    hard_violations_kept: hardViolationsKept,
    warnings,
    catalog_health: catalogHealth,
  };
  if (gapFilled.length) out.gap_filled = gapFilled;
  return out;
}
