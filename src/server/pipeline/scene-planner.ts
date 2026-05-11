import OpenAI from "openai";
import { TAG_VOCAB } from "@/server/tag-vocab";
import { detectRegions } from "./hebrew-places";
import type { Scene, WhisperSegment } from "@/shared/types";

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

2. **Time-of-day shifts inside one Whisper segment** ("היום חם, בערב גשם") with NO multi-region split available → keep one scene + \`kind: "list"\`.

3. **A coherent visual idea spanning multiple Whisper segments** ("קור עם שלג בחרמון" + "ברוחות עזות") → MERGE into ONE scene with \`kind: "prose"\`.

4. **\`kind: "list"\` is HOMOGENEOUS only** — ≥3 distinct fact-units of the SAME KIND (city-by-city temperature roll, day-of-week recap, percentage breakdown). Multi-region narration enumerating ≥2 different regions is NOT a \`list\`; it is \`prose\` if you can split it, or — if unsplittable — \`kind: "list"\` with \`heterogeneous: true\` so the picker knows to choose one shot per region. Hebrew connectives "ו" / "," alone do NOT make a list.

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

  return merged;
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

export async function planScenes(
  transcriptText: string,
  whisperSegments: WhisperSegment[],
  durationSec: number,
  customPrompt?: string
): Promise<Scene[]> {
  if (!transcriptText?.trim() || !durationSec) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  const client = new OpenAI({ apiKey });
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
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.3,
      seed: 42,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const raw = JSON.parse(content) as Record<string, unknown>;
    const rawScenes = Array.isArray(raw.scenes) ? (raw.scenes as unknown[]) : null;
    if (!rawScenes) return [];
    return validateScenes(rawScenes, whisperSegments, durationSec);
  } catch (err) {
    // Re-throw auth/quota errors; swallow other failures
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid_api_key") || msg.includes("authentication")) throw err;
    if (msg.includes("insufficient_quota") || msg.includes("exceeded_quota")) throw err;
    console.warn(`planScenes: LLM call failed: ${msg}`);
    return [];
  }
}
