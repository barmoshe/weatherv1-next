import { z } from "zod";
import { TAG_VOCAB } from "@/server/tag-vocab";
import { detectRegions } from "./hebrew-places";
import { getLlmProvider, LlmProviderError } from "@/server/providers/llm";
import type { Scene, WhisperSegment } from "@/shared/types";
import type { LlmCallUsage } from "@/shared/usage";

const MIN_SCENE_DURATION = 3.0;
const MAX_SCENES = 8;
const ALLOWED_KINDS = new Set(["prose", "list", "transition"]);

function safeFloat(value: unknown, def = 0.0): number {
  if (value == null) return def;
  const n = parseFloat(String(value));
  return isNaN(n) ? def : n;
}

export const DEFAULT_SCENE_PROMPT = `You are a narrative editor for short Hebrew weather-forecast videos. Given a transcript and Whisper sentence segments, split the narration into contextual SCENES that the clip picker will then illustrate.

A scene is a coherent visual moment — one beat the editor wants to show on screen. Scene boundaries MUST be picked from the Whisper segment boundaries provided (you may not invent boundaries mid-sentence).

SCENE-COUNT TARGETS (scales with audio length — DO NOT undersplit):
  - ≤15s audio → 3 scenes
  - 15–25s audio → 4 scenes
  - 25–35s audio → 5 scenes
  - 35–45s audio → 6 scenes
  - >45s audio → 6–8 scenes (cap at 8)
  Minimum scene length: 3s. A 12s "prose" super-scene is a smell — split it if the included Whisper segments cover ≥2 distinct temporal markers (היום / מחר / סוף השבוע / בערב / השבוע / השבת) or ≥2 distinct weather states (קור / עלייה / טפטוף / בהיר / מעונן / חם).

CRITICAL HEURISTICS — these are the failure modes to fix:

1. **Multi-region narration** — when one Whisper segment carries ≥2 distinct entries in its \`regions\` annotation (e.g. \`["gaza", "northern-border"]\`, or "במרכז שמש, בצפון עננים"), prefer SPLIT at the closest Whisper segment boundary even if the cut bleeds ≤2s of one region's tail into the neighbor's narration. A ≤2s thematic bleed is acceptable; a 16s mashed multi-region scene is not. The segment-level \`multi_region: true\` flag is your primary signal.

   **Concurrent regions + weather** — if the same stretch of audio ties **place names** (צפון / מרכז / דרום / חוף) to **different simultaneous conditions** (מעונן, טפטוף, שמש, חם), do NOT label it a homogeneous \`list\` of generic facts; prefer split scenes or \`kind: "list"\` with \`heterogeneous: true\` so the downstream picker can assign one visual per region+weather.

2. **Time-of-day shifts inside one Whisper segment** ("היום חם, בערב גשם") with NO multi-region split available → keep one scene + \`kind: "list"\`.

3. **A coherent visual idea spanning multiple Whisper segments** ("קור עם שלג בחרמון" + "ברוחות עזות") → MERGE into ONE scene with \`kind: "prose"\`.

4. **\`kind: "list"\` is HOMOGENEOUS only** — ≥3 distinct fact-units of the SAME KIND (city-by-city temperature roll, day-of-week recap, percentage breakdown). Multi-region narration enumerating ≥2 different regions is NOT a \`list\`; it is \`prose\` if you can split it, or — if unsplittable — \`kind: "list"\` with \`heterogeneous: true\` so the picker knows to choose one shot per region. Hebrew connectives "ו" / "," alone do NOT make a list. **Concrete smell:** "בצפון ובמרכז" (or similar) plus weather wording (מעונן / טפטוף / גשם) → MUST use \`heterogeneous: true\`, never homogeneous \`list\`.

5. **Brief transitions** ("לסיכום", "ועכשיו", "אז") under 2s → MERGE into the neighbor scene (don't make 1-second standalone scenes).

Per scene return:
  - idx: 0-based integer in narration order
  - start_sec / end_sec: floats, taken from Whisper segment boundaries
  - title_he: ≤8 Hebrew words summarizing the visual moment ("פתיחה — שמש זורחת מעל העיר")
  - narration: the merged Hebrew text from the included Whisper segments
  - keywords: 2–4 visual hints (mix of vocab + free-form Hebrew/English). Examples from the suggestion vocab: ${TAG_VOCAB.slice(0, 8).join(", ")}, etc.
  - mood: one of cheerful / calm / dramatic / gloomy (optional, omit if unclear)
  - kind: "prose" | "list" | "transition"
  - heterogeneous: true ONLY when \`kind: "list"\` AND the scene enumerates ≥2 different geographic regions (so the picker chooses one shot per region). Omit otherwise.
  - whisper_beat_indices: list of integer indices into the input Whisper segments included in this scene

OUTPUT: a single JSON object with key \`scenes\` containing an ordered array. Scenes must cover the full duration with no gaps and no overlap.`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function whisperBoundaries(segs: WhisperSegment[], durationSec: number): number[] {
  const bounds = new Set([0.0, safeFloat(durationSec)]);
  for (const seg of segs) bounds.add(safeFloat(seg.end));
  return Array.from(bounds).filter((b) => b >= 0).sort((a, b) => a - b);
}

function snap(value: number, boundaries: number[]): number {
  if (!boundaries.length) return value;
  return boundaries.reduce((best, b) =>
    Math.abs(b - value) < Math.abs(best - value) ? b : best
  );
}

function coerceKeywords(value: unknown): string[] {
  if (!value) return [];
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (Array.isArray(value)) {
    const out: string[] = [];
    for (const item of value) {
      const s = String(item).trim();
      if (s) out.push(s);
    }
    return [...new Set(out)].slice(0, 4);
  }
  return [];
}

function coerceMood(value: unknown): string | undefined {
  if (!value) return undefined;
  const s = String(value).trim().toLowerCase();
  return ["cheerful", "calm", "dramatic", "gloomy"].includes(s) ? s : undefined;
}

function coerceKind(value: unknown): "prose" | "list" | "transition" {
  if (!value) return "prose";
  const s = String(value).trim().toLowerCase();
  return ALLOWED_KINDS.has(s) ? (s as "prose" | "list" | "transition") : "prose";
}

function coerceIntList(value: unknown): number[] {
  if (!value || !Array.isArray(value)) return [];
  const out: number[] = [];
  for (const item of value) {
    const n = parseInt(String(item));
    if (!isNaN(n)) out.push(n);
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

function beatsWithin(
  start: number,
  end: number,
  segs: WhisperSegment[]
): number[] {
  const out: number[] = [];
  for (let i = 0; i < segs.length; i++) {
    const s = safeFloat(segs[i].start);
    const e = safeFloat(segs[i].end);
    const mid = (s + e) / 2;
    if (start <= mid && mid < end) out.push(i);
    else if (i === segs.length - 1 && mid <= end) out.push(i);
  }
  return out;
}

function mergeIndexIntoNeighbor(scenes: Scene[], i: number): Scene[] {
  if (scenes.length <= 1) return scenes;
  let target: number;
  if (i === 0) {
    target = 1;
  } else if (i === scenes.length - 1) {
    target = i - 1;
  } else {
    const left = scenes[i - 1].end_sec - scenes[i - 1].start_sec;
    const right = scenes[i + 1].end_sec - scenes[i + 1].start_sec;
    target = left >= right ? i - 1 : i + 1;
  }
  const lo = Math.min(i, target);
  const hi = Math.max(i, target);
  const a = scenes[lo];
  const b = scenes[hi];
  const tgt = scenes[target];
  const cur = scenes[i];
  const merged: Scene = {
    idx: lo,
    start_sec: a.start_sec,
    end_sec: b.end_sec,
    title_he: tgt.title_he || cur.title_he,
    narration: `${a.narration} ${b.narration}`.trim(),
    keywords: [...new Set([...(tgt.keywords ?? []), ...(cur.keywords ?? [])])].slice(0, 4),
    mood: tgt.mood ?? cur.mood,
    kind: tgt.kind ?? cur.kind ?? "prose",
    heterogeneous: !!(tgt.heterogeneous || cur.heterogeneous),
    whisper_beat_indices: [
      ...new Set([...(cur.whisper_beat_indices ?? []), ...(tgt.whisper_beat_indices ?? [])]),
    ].sort((a, b) => a - b),
  };
  return [...scenes.slice(0, lo), merged, ...scenes.slice(hi + 1)];
}

function mergeShort(scenes: Scene[]): Scene[] {
  if (!scenes.length) return scenes;
  let out = [...scenes];
  let i = 0;
  while (i < out.length) {
    const dur = out[i].end_sec - out[i].start_sec;
    if (dur >= MIN_SCENE_DURATION || out.length === 1) {
      i++;
      continue;
    }
    out = mergeIndexIntoNeighbor(out, i);
    i = Math.max(0, i - 1);
  }
  return out;
}

/** Homogeneous `list` + ≥2 macro-regions triggers ONE-ambient picks that ignore facts; coerce to heterogeneous. */
function coerceHeterogeneousForMultiRegionLists(scenes: Scene[]): Scene[] {
  return scenes.map((s) => {
    if (s.kind !== "list" || s.heterogeneous) return s;
    const slugs = new Set(detectRegions(s.narration ?? "").map((h) => h.slug));
    if (slugs.size >= 2) return { ...s, heterogeneous: true };
    return s;
  });
}

function validateScenes(
  rawScenes: unknown[],
  whisperSegs: WhisperSegment[],
  durationSec: number
): Scene[] {
  const duration = safeFloat(durationSec);
  const boundaries = whisperBoundaries(whisperSegs, duration);

  const cleaned: Scene[] = [];
  for (const raw of rawScenes ?? []) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const start = parseFloat(String(r.start_sec));
    const end = parseFloat(String(r.end_sec));
    if (isNaN(start) || isNaN(end) || end <= start) continue;
    const snappedStart = snap(start, boundaries);
    const snappedEnd = snap(end, boundaries);
    if (snappedEnd <= snappedStart) continue;
    cleaned.push({
      idx: 0,
      start_sec: Math.round(snappedStart * 100) / 100,
      end_sec: Math.round(snappedEnd * 100) / 100,
      title_he: String(r.title_he ?? "").trim(),
      narration: String(r.narration ?? "").trim(),
      keywords: coerceKeywords(r.keywords),
      mood: coerceMood(r.mood) as Scene["mood"],
      kind: coerceKind(r.kind),
      heterogeneous: !!r.heterogeneous,
      whisper_beat_indices: coerceIntList(r.whisper_beat_indices),
    });
  }

  if (!cleaned.length) return [];
  cleaned.sort((a, b) => a.start_sec - b.start_sec);

  // Patch gaps + drop overlaps
  const fixed: Scene[] = [cleaned[0]];
  for (const s of cleaned.slice(1)) {
    const prev = fixed[fixed.length - 1];
    if (s.start_sec >= prev.end_sec) {
      if (s.start_sec > prev.end_sec) prev.end_sec = s.start_sec;
      fixed.push(s);
    } else if (s.end_sec > prev.end_sec) {
      s.start_sec = prev.end_sec;
      if (s.end_sec > s.start_sec) fixed.push(s);
    }
  }

  if (duration > 0) {
    fixed[0].start_sec = 0.0;
    fixed[fixed.length - 1].end_sec = duration;
  }

  let merged = mergeShort(fixed);

  while (merged.length > MAX_SCENES) {
    const idx = merged.reduce(
      (best, s, i) =>
        s.end_sec - s.start_sec < merged[best].end_sec - merged[best].start_sec ? i : best,
      0
    );
    merged = mergeIndexIntoNeighbor(merged, idx);
  }

  for (let i = 0; i < merged.length; i++) {
    merged[i].idx = i;
    merged[i].whisper_beat_indices = beatsWithin(
      merged[i].start_sec,
      merged[i].end_sec,
      whisperSegs
    );
    if (!merged[i].narration && merged[i].whisper_beat_indices.length) {
      merged[i].narration = merged[i].whisper_beat_indices
        .map((bi) => String(whisperSegs[bi]?.text ?? "").trim())
        .join(" ")
        .trim();
    }
    if (!merged[i].title_he) {
      const n = merged[i].narration;
      merged[i].title_he = n.length > 40 ? `${n.slice(0, 40)}…` : n;
    }
  }

  return coerceHeterogeneousForMultiRegionLists(merged);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function fallbackSingleScene(
  transcriptText: string,
  whisperSegments: WhisperSegment[],
  durationSec: number
): Scene[] {
  const duration = safeFloat(durationSec);
  if (duration <= 0) return [];
  const text = (transcriptText ?? "").trim();
  return [
    {
      idx: 0,
      start_sec: 0.0,
      end_sec: Math.round(duration * 100) / 100,
      title_he: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      narration: text,
      keywords: [],
      mood: undefined,
      kind: "prose",
      heterogeneous: false,
      whisper_beat_indices: Array.from({ length: whisperSegments.length }, (_, i) => i),
    },
  ];
}

// Loose schema for the LLM's raw scene proposals. The downstream
// `validateScenes` is the authoritative shape enforcement (snapping,
// merging, idx assignment), so we accept any object payload here and
// keep validation work in one place.
const ScenePlanResponseSchema = z.object({
  scenes: z.array(z.record(z.unknown())).default([]),
});

// ---------------------------------------------------------------------------
// Ver2 — concept-forecasting planner (no prescriptive scene-count table, no seed)
// ---------------------------------------------------------------------------

/**
 * Ver2 prompt: editorial intent only — no duration→scene-count table, no
 * multi-region forced-split rule. The model decides the count from the
 * narration's natural beats and emits `desired_concepts` (weather /
 * season_mood / visual_role / scene_fit / avoid_for) per scene so the
 * downstream retrieval step can build a relevant shortlist for the picker.
 */
export const DEFAULT_SCENE_PROMPT_VER2 = `You are a narrative editor for short Hebrew weather-forecast videos. Given a transcript and Whisper sentence segments, split the narration into ordered SCENES — editorial beats the picker will illustrate — and for each scene, emit the catalog-concept query that should retrieve relevant clips.

A scene is one visual moment. Scene boundaries MUST come from the provided Whisper segment boundaries (never invent mid-sentence cuts).

GUIDING INTENT (no arithmetic):
  - Cut where the narration's beat shifts — a new region, a new weather state, a new time-of-day, a change in tone. Merge brief connectives (≤2s) into a neighbour.
  - Pick the number of scenes that feels like cutting a film. A homogeneous forecast can be 2–3 scenes; a multi-region day with shifting weather can be 6–8. Do not undersplit a multi-region narration into one super-scene.
  - Each scene should feel like one shot's worth of content. If two regions are mentioned with simultaneously different weather, prefer two scenes (or \`kind: "list"\` with \`heterogeneous: true\`) rather than one ambient catch-all.

Per scene return:
  - idx: 0-based integer in narration order
  - start_sec / end_sec: floats from Whisper segment boundaries
  - title_he: ≤8 Hebrew words summarizing the visual moment
  - narration: merged Hebrew text from the included Whisper segments
  - keywords: 2–4 visual hints (Hebrew/English)
  - mood: cheerful / calm / dramatic / gloomy (optional)
  - kind: "prose" | "list" | "transition"
  - heterogeneous: true ONLY when \`kind: "list"\` AND the scene enumerates ≥2 geographic regions
  - whisper_beat_indices: integer indices into the input Whisper segments
  - desired_concepts: object with optional arrays \`weather\`, \`season_mood\`, \`visual_role\`, \`scene_fit\`, \`avoid_for\` — drawn from the Hebrew concept vocab (e.g. weather: שרב, חם, בהיר, מעונן, גשם, רוח, ברד, שלג). These are the retrieval keys for this scene's clip shortlist; be specific. Use \`avoid_for\` to anchor negative space (e.g. when narration says a heat wave is *ending*, set \`avoid_for: ["שרב","חם"]\` so heat clips are penalised in retrieval).
  - desired_keywords: 3–6 free-form Hebrew/English visual descriptors complementing \`desired_concepts\` (these feed BM25 on the catalog's descriptions).
  - pick_count_hint: 1 or 2 — your editorial call on how many clips this scene wants (longer scenes and heterogeneous scenes typically want 2).
  - variety_intent: one short Hebrew sentence describing the feel/angle this scene wants (e.g. "פתיחה רגועה — נוף עירוני שקט מתחת לשמיים אפורים"). The downstream picker uses this to break ties.

OUTPUT: a single JSON object with key \`scenes\` containing an ordered array. Scenes cover the full duration with no gaps and no overlap.`;

const ScenePlanResponseVer2Schema = z.object({
  scenes: z.array(z.record(z.unknown())).default([]),
});

function coerceStringList(value: unknown, max = 8): string[] {
  if (!value) return [];
  const out: string[] = [];
  const items = Array.isArray(value) ? value : [value];
  for (const item of items) {
    const s = String(item ?? "").trim();
    if (s) out.push(s);
  }
  return [...new Set(out)].slice(0, max);
}

function coerceDesiredConcepts(value: unknown): Scene["desired_concepts"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const key of ["weather", "season_mood", "visual_role", "scene_fit", "avoid_for"] as const) {
    const list = coerceStringList(v[key], 8);
    if (list.length) out[key] = list;
  }
  return Object.keys(out).length ? (out as Scene["desired_concepts"]) : undefined;
}

function coercePickCountHint(value: unknown): 1 | 2 | undefined {
  const n = parseInt(String(value), 10);
  if (n === 1 || n === 2) return n;
  return undefined;
}

function applyVer2Fields(scene: Scene, raw: Record<string, unknown>): Scene {
  const desired = coerceDesiredConcepts(raw.desired_concepts);
  if (desired) scene.desired_concepts = desired;
  const keywords = coerceStringList(raw.desired_keywords, 6);
  if (keywords.length) scene.desired_keywords = keywords;
  const hint = coercePickCountHint(raw.pick_count_hint);
  if (hint) scene.pick_count_hint = hint;
  const variety = String(raw.variety_intent ?? "").trim();
  if (variety) scene.variety_intent = variety.length > 200 ? `${variety.slice(0, 197)}…` : variety;
  return scene;
}

export async function planScenesVer2(
  transcriptText: string,
  whisperSegments: WhisperSegment[],
  durationSec: number,
  customPrompt?: string,
): Promise<{ scenes: Scene[]; usage?: LlmCallUsage }> {
  if (!transcriptText?.trim() || !durationSec) return { scenes: [] };

  const provider = getLlmProvider();
  const systemPrompt = customPrompt?.trim() ? customPrompt.trim() : DEFAULT_SCENE_PROMPT_VER2;

  const indexedSegments = whisperSegments.map((seg, i) => {
    const text = String(seg.text ?? "").trim();
    const regions = detectRegions(text);
    const distinct = [...new Set(regions.map((r) => r.slug))].sort();
    const entry: Record<string, unknown> = {
      idx: i,
      start: safeFloat(seg.start),
      end: safeFloat(seg.end),
      text,
    };
    if (distinct.length) {
      entry.regions = distinct;
      if (distinct.length >= 2) entry.multi_region = true;
    }
    return entry;
  });

  const payload = {
    duration_sec: safeFloat(durationSec),
    transcript: transcriptText,
    whisper_segments: indexedSegments,
  };

  try {
    const { data, usage } = await provider.completeJson({
      systemPrompt,
      userPayload: JSON.stringify(payload, null, 2),
      schema: ScenePlanResponseVer2Schema,
      schemaName: "scene_plan_response_ver2",
      schemaDescription:
        "Hebrew weather narration → ordered scenes with retrieval keys (desired_concepts, desired_keywords) for the downstream catalog-shortlist step.",
      options: {
        temperature: 0.5,
        // intentionally no seed — variety across renders is a first-class requirement
        cacheSystemPrompt: !customPrompt,
      },
    });

    const rawScenes = data.scenes ?? [];
    const validated = validateScenes(rawScenes, whisperSegments, durationSec);
    // Re-attach Ver2 fields by matching idx in the raw response back onto validated scenes.
    for (const scene of validated) {
      const raw = rawScenes.find(
        (r) => parseInt(String((r as Record<string, unknown>).idx ?? -1), 10) === scene.idx,
      ) as Record<string, unknown> | undefined;
      if (raw) applyVer2Fields(scene, raw);
    }
    return { scenes: validated, usage };
  } catch (err) {
    if (err instanceof LlmProviderError) {
      if (err.code === "llm_invalid_key" || err.code === "llm_quota_exceeded") throw err;
      console.warn(`planScenesVer2: LLM call failed: ${err.message}`);
      return { scenes: [] };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`planScenesVer2: LLM call failed: ${msg}`);
    return { scenes: [] };
  }
}

// ---------------------------------------------------------------------------
// Ver1 — original planner
// ---------------------------------------------------------------------------

export async function planScenes(
  transcriptText: string,
  whisperSegments: WhisperSegment[],
  durationSec: number,
  customPrompt?: string,
): Promise<{ scenes: Scene[]; usage?: LlmCallUsage }> {
  if (!transcriptText?.trim() || !durationSec) return { scenes: [] };

  const provider = getLlmProvider();
  const systemPrompt =
    customPrompt?.trim() ? customPrompt.trim() : DEFAULT_SCENE_PROMPT;

  // Enrich Whisper segments with region annotations for the planner
  const indexedSegments = whisperSegments.map((seg, i) => {
    const text = String(seg.text ?? "").trim();
    const regions = detectRegions(text);
    const distinct = [...new Set(regions.map((r) => r.slug))].sort();
    const entry: Record<string, unknown> = {
      idx: i,
      start: safeFloat(seg.start),
      end: safeFloat(seg.end),
      text,
    };
    if (distinct.length) {
      entry.regions = distinct;
      if (distinct.length >= 2) entry.multi_region = true;
    }
    return entry;
  });

  const payload = {
    duration_sec: safeFloat(durationSec),
    transcript: transcriptText,
    whisper_segments: indexedSegments,
  };

  try {
    const { data, usage } = await provider.completeJson({
      systemPrompt,
      userPayload: JSON.stringify(payload, null, 2),
      schema: ScenePlanResponseSchema,
      schemaName: "scene_plan_response",
      schemaDescription:
        "Hebrew weather narration split into ordered scenes for a downstream clip picker.",
      options: {
        temperature: 0.3,
        seed: 42,
        cacheSystemPrompt: !customPrompt,
      },
    });

    return {
      scenes: validateScenes(data.scenes ?? [], whisperSegments, durationSec),
      usage,
    };
  } catch (err) {
    if (err instanceof LlmProviderError) {
      if (err.code === "llm_invalid_key" || err.code === "llm_quota_exceeded") throw err;
      console.warn(`planScenes: LLM call failed: ${err.message}`);
      return { scenes: [] };
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`planScenes: LLM call failed: ${msg}`);
    return { scenes: [] };
  }
}
