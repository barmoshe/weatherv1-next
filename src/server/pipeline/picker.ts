import { z } from "zod";
import { fallbackSingleScene } from "./scene-planner";
import { SOURCE_VALUES } from "@/server/tag-vocab";
import { getLlmProvider, LlmProviderError } from "@/server/providers/llm";
import { getTranscriptionProvider } from "@/server/providers/transcription";
import type { TranscriptionResult } from "@/server/providers/transcription/types";
import type { LlmErrorCode, LlmProviderId } from "@/server/providers/llm";
import type {
  Scene,
  WhisperSegment,
  TimelinePick,
  ParsedVideo,
  SegmentConcepts,
  SegmentMapEntry,
} from "@/shared/types";
import type { UsageCallRecord, LlmCallUsage } from "@/shared/usage";
import { validateAndSwap, type MutablePick, type ValidatorBundle } from "@/server/pipeline/validator";

// ---------------------------------------------------------------------------
// Scene-aware system prompt
// ---------------------------------------------------------------------------

/** Shown beside \`catalog\` in picker JSON — anchors clip-uniqueness in the user message. */
export const PICKER_CLIP_DIVERSITY_NOTE = [
  "CLIP DIVERSITY (read with catalog): Each clip_id is one source file; each row is one segment_id on that file.",
  "Default: use a given clip_id at most once across the whole timeline.",
  "Exception: the same clip_id may appear exactly twice only as two different segment_id rows whose tags + Hebrew description clearly imply different shots (different thumbnails). Never three picks from one clip_id.",
  "start_sec/end_sec on a row are edit handles, not evidence of visual difference—do not use them alone to defend reusing clip_id.",
].join(" ");

export const SCENE_AWARE_SYSTEM_PROMPT = `You are a video editor for short Hebrew weather forecasts. The narration has already been split into ordered SCENES (semantic narration blocks). Your job: for EACH scene, pick 1 or 2 catalog segments (see pick-count rules below) that visually fit **and** build a coherent, non-repetitive picture cut.

**Decision order (every plan)**  
1) For each scene, decide pick count from duration and scene \`kind\` (below).  
2) For each candidate row, mentally note its \`clip_id\`; **prefer spreading work across different \`clip_id\` files** unless the narrow exception in B2 applies.  
3) Match weather and narration (A, A1, A3) before debating variety.  
4) Emit picks for **all** scenes with correct \`scene_idx\`; keep global anti-repeat constraints B + B2 in mind across the entire timeline—not per scene in isolation.

**Catalog row anatomy** — Each row is one **\`segment_id\`** tied to exactly one **\`clip_id\`** (source file). Fields include Hebrew description, Hebrew keyword tags, and \`start_sec\`/\`end_sec\` (**trim controls only—do not cite time overlap or separation as proof that two segments “look different”**). Diversity of shots is inferred from **tags + description semantics**, not from timestamps alone. Live catalog tags are Hebrew-only.

Catalog tags are Hebrew-only. New rows may also include structured \`concepts\`:
  weather: שרב, חם, בהיר, מעונן, גשם, רוח, ברד, שלג
  season_mood: קיצי, חורפי, סתווי, אביבי, מעבר
  visual_role: רקע כללי, אזהרת מזג אוויר, עומס חום, הקלה בחום, תחזית ים, לבוש, עיר, טבע
  scene_fit: פתיחה חמה, שרב, טמפרטורות, סוף שבוע נעים, קרינת שמש, ים ושקיעה
  avoid_for: concepts this shot must NOT illustrate.

Source values (clip-level attribution):
  ${SOURCE_VALUES.join(", ")}

PER-SCENE PICKING RULES

1. **Pick count per scene** — pick exactly the number of clips appropriate to the scene's duration and kind:
   - **\`heterogeneous: true\`** (multi-region scene) → pick **1 clip PER named region** in the narration order (typically 2 picks). Allocate the audio range proportionally to where each region appears in the narration — earlier-mentioned region gets the earlier audio sub-range. The per-region pick MUST match that region's stated weather (see A1). **Overrides the usual one-clip rule for scenes under \`duration_sec < 12\`** when two regions appear — use two shorter sub-ranges, not one ambient shot that ignores regional weather.
   - **\`duration_sec\` < 12** and **not** \`heterogeneous: true\` → pick **1** clip covering the full audio range (\`audio_start = scene.start_sec\`, \`audio_end = scene.end_sec\`).
   - **\`duration_sec\` ≥ 12** (and not heterogeneous) → **prefer 2 picks**: a primary shot and a complementary shot. Equal-split the audio range: pick A covers \`start..mid\`, pick B covers \`mid..end\`. Default → **different \`clip_id\`** and different \`segment_id\`; use the SAME \`clip_id\` twice only under the rare **Clip reuse exception** in CORE RULES (B2). BOTH picks must still match the scene's narration.

2. **COVERAGE — each pick's segment \`duration\` MUST be ≥ its assigned audio sub-range**. Each catalog row carries a \`duration\` field; check it before picking. If no single segment covers the assigned range, pick the longest acceptable segment and the validator will split it further; never deliberately under-cover.

3. **Scene \`kind\` matters:**
   - \`prose\`      → segment(s) that visually match the scene's narration.
   - \`list\` + \`heterogeneous: false\` → Use **tabular-style** lists only: temperature rolls, day-of-week recaps, percentage breakdowns → ONE calm, AMBIENT shot related to season / gentle weather vibe (NOT a literal match line-by-line — no cut per city/day). Lean on broad concepts like \`שמיים\`, \`עיר\`, \`עננים\`, \`רגוע\`, \`נוף\`, \`הר\`. **Never** apply this ambient escape hatch when narration is mainly **regions + simultaneous weather states** (\`צפון\` + \`מרכז\` + מעונן/טפטוף etc.) — that pattern should upstream be \`heterogeneous: true\`; if it still arrives as homogeneous, **match weather first (A1, A3)** with a generic overcast/drizzle-appropriate landscape, not unrelated sunny-coast / landmark glamour B-roll.
   - \`list\` + \`heterogeneous: true\` → follow rule 1's per-region rule (NOT the ONE-ambient rule).
   - \`transition\` → a brief, calm cutaway that doesn't fight the narration ("ועכשיו…", "לסיכום…").

4. Each pick MUST carry the scene's \`idx\` as \`scene_idx\`. Without it, the validator cannot map picks back to scenes.

5. Each scene's \`keywords\` are SUGGESTIONS, not a whitelist. The scene's \`narration\` (Hebrew sentence) and \`mood\` are the primary signal — read them holistically, not as keyword bags.

CORE RULES

A. **Holistic interpretation, not literal keyword match.** Read the scene's narration, pick by intent.
A1. **Weather state outranks geography.** When the narration mentions a weather state (גשם / עננים / שמש / שלג / סופה / ערפל / רוח / חם / קר / שרב / חמסין), the picked segment's weather/concept signal MUST match. Wrong-weather + right-place is worse than right-weather + generic-place.
A2. **When no candidate scores high on the dominant signal, fall back to a generic AMBIENT shot that fits the weather mood** — a wide sky shot, calm city skyline, generic seasonal landscape — rather than a thematically-off specific shot.
A3. **Sky-state tags.** Match \`מעונן\` / \`חורפי\` / wet concepts to overcast or rainy narration (מעונן / טפטוף / חורפי); match \`שמיים בהירים\`, \`בהיר\`, \`שמש\`, \`קיצי\`, or \`חם\` to sunny narration (יום בהיר / שמשי / חם). Don't pick a partly-cloudy summer-looking clip for an overcast scene.
B. **Anti-repeat (\`segment_id\`)**: a \`segment_id\` appears at most twice across the whole timeline; never within 2 scenes of its previous use. Independent of B2 (parent file).
B2. **Parent file diversity (\`clip_id\`) — default once per file, rare exception**
   - **Default**: each \`clip_id\` appears **at most once** in \`timeline\` (deal from the deck; do not “double-dip” the same file without strong cause).
   - **When is reuse allowed?** Only if you need **exactly two** picks that both use the **same** \`clip_id\` **and** they refer to **two different \`segment_id\` rows** where **tags + Hebrew descriptions** obviously describe **different shots** (different subject, setting, or weather read—**as if two different still frames / thumbnails**). If you are unsure the two rows are truly different ideas, pick another \`clip_id\` instead.
   - **Never**: three or more picks sharing one \`clip_id\`; or two picks on one \`clip_id\` that read as the **same motif** (near-duplicate tags or copy-paste descriptions).
   - **If you use the exception**: both picks’ \`reason\` must name **what is different on screen** per row (from tags/description), **not** timecodes.
C. **Clothing rule**: only pick a clothing-tagged segment (coat / fur / scarf / sandals / swimsuit / umbrella) when the scene's narration is **explicitly about what to wear** ("מבחינת לבוש", "ללבוש"). For weather narration pick a landscape / urban / aerial / nature alternative instead.
D. **Tagged beats untagged**, but a good untagged pick beats no segment.
E. **Source preference** (soft): prefer \`original\` when the narration is local-color editorial. Otherwise tag-fit wins.
F. **\`reason\`** — one short Hebrew sentence: what in this segment supports the scene. Under **B2** (same \`clip_id\` twice), the two reasons must **not** paraphrase each other; each must reflect that row’s **distinct** tags/description.
G. **Sub-range picking**: by default, set \`video_start\` = the segment's \`start_sec\` and \`video_end\` = \`start_sec\` + (audio_end - audio_start). Only use a different sub-range if you specifically want a portion of the segment.
H. **Variety across renders**: when several rows tie on fit, prefer the less-obvious row and an unused \`clip_id\` over recycling the same file. Two runs of the same forecast should not return identical timelines if the catalog allows alternatives.
I. **Time-of-day vs narration.** When the narration clearly refers to daytime (\`היום\`, \`מחר בבוקר\`, \`צהריים\`) prefer segments whose tags imply matching light state (\`יום\`, \`צהריים\`, \`שמיים בהירים\`). Do not pick \`לילה\` / \`בין ערביים\` / glamour coastal dusk unless the narration is about evening or tags explicitly match. **Geography alone** (\`מרכז\`, \`צפון\`) is a weak tie-breaker—wet/cloud/drizzle (\`טפטוף\`, \`מעונן\`) and sky state must align first.

OUTPUT — Return only a valid JSON object with \`timeline\`: an array of picks in narrative/time order, each with \`scene_idx\`, \`segment_id\`, \`audio_start\`, \`audio_end\`, optional \`video_start\`/\`video_end\` (default = segment span; system may adjust), and \`reason\`. Cover **every** scene; no omitted scenes.`;

/** Appended to the system prompt on picker attempts 2–3 (after empty output or validator-driven retry). */
export const PICKER_FALLBACK_PROMPT = `**RETRY MODE** — a previous attempt failed (empty plan and/or automated validation swaps). You MUST produce a full valid timeline covering every scene.

- Treat \`retry_feedback\` in the user JSON (when present) as mandatory context: those rows were statistically or rule-swapped away—**do not** re-select the same \`segment_id\` values listed under \`rejected_segment_ids\`.
- **Weather and sky state beat landmarks.** If narration is drizzle/clouds (\`טפטוף\`, \`מעונן\`, \`עננים\`), never substitute an unrelated sunny coast, iconic night tower shot, or “pretty” B-roll that only matches \`מרכז\` or \`ים\` tags without matching wet/grey sky semantics.
- **Multi-region + weather:** if the scene lists two regions with conditions, pick segments that match each region’s stated weather on its audio sub-range (\`heterogeneous: true\`); one scenic “מרכז” landmark is insufficient if the narration also demands northern drizzle.
- Prefer **generic ambient** over wrong-specific: wide grey sky, calm urban skyline, overcast hills—when in doubt after a failed attempt.
- Output **non-empty** \`timeline\`; every \`segment_id\` must exist in the attached catalog.`;

// ---------------------------------------------------------------------------
// Zod schema for LLM response (Risk A5 mitigation)
// ---------------------------------------------------------------------------

const PickResponseSchema = z.object({
  timeline: z.array(
    z.object({
      scene_idx: z.number().optional(),
      segment_id: z.string(),
      audio_start: z.number(),
      audio_end: z.number(),
      video_start: z.number().optional(),
      video_end: z.number().optional(),
      reason: z.string().optional().default(""),
    })
  ),
});

// ---------------------------------------------------------------------------
// Catalog preparation
// ---------------------------------------------------------------------------

interface CatalogRow {
  segment_id: string;
  clip_id: string;
  start_sec: number;
  end_sec: number;
  duration: number;
  orientation: string;
  tags?: string[];
  concepts?: Partial<SegmentConcepts>;
  description?: string;
  source?: string;
}

export interface PickerRunStatus {
  state: "ok" | "empty" | "failed";
  provider?: LlmProviderId;
  model?: string;
  catalog_rows: number;
  scenes_requested: number;
  payload_bytes: number;
  usable_picks: number;
  error_code?: LlmErrorCode | "picker_empty";
  error?: string;
  /** How many LLM round-trips were executed for this plan (includes retries). */
  llm_attempts_used?: number;
  /** Short summary when retries were exhausted while validator still wanted swaps. */
  last_retry_reason?: string;
  /** Compact digest of validator-driven retry triggers (debugging). */
  validator_feedback_digest?: string;
}

export interface PickerValidationContext {
  segmentMap: Record<string, SegmentMapEntry>;
  videoMap: Record<string, ParsedVideo>;
  scenes: Scene[];
  beats?: Array<{ idx: number; start: number; end: number; text: string }>;
  allowSceneGapFill?: boolean;
}

export interface PickSegmentsResult {
  timeline: TimelinePick[];
  picker_status: PickerRunStatus;
  /** Present when `validationContext` was passed and validation ran at least once. */
  validator?: ValidatorBundle;
  /** Successful LLM round-trips in this Detailed run (one entry per picker attempt). */
  picker_usages?: UsageCallRecord[];
}

export class PickerFailureError extends Error {
  constructor(
    message: string,
    public readonly picker_status: PickerRunStatus,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "PickerFailureError";
  }
}

function compactConcepts(concepts: SegmentConcepts | undefined): Partial<SegmentConcepts> | undefined {
  if (!concepts) return undefined;
  const out: Partial<SegmentConcepts> = {};
  for (const key of ["weather", "season_mood", "visual_role", "scene_fit", "avoid_for"] as const) {
    const values = concepts[key]?.map((v) => String(v).trim()).filter(Boolean) ?? [];
    if (values.length) out[key] = [...new Set(values)];
  }
  return Object.keys(out).length ? out : undefined;
}

function sanitizePickerError(message: string): string {
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "sk-***").replace(/ant-[A-Za-z0-9_-]+/g, "ant-***").slice(0, 700);
}

export function prepareCatalog(videos: ParsedVideo[]): CatalogRow[] {
  const out: CatalogRow[] = [];
  for (const v of videos ?? []) {
    const clipId = v.id;
    if (!clipId) continue;
    const clipDur = v.duration_sec ?? 0;
    const clipOrient = v.orientation ?? "H";
    const clipSrc = v.source;
    for (const seg of v.segments ?? []) {
      const segId = seg.id || `${clipId}-s0`;
      const segStart = parseFloat(String(seg.start_sec ?? 0)) || 0;
      const segEnd = parseFloat(String(seg.end_sec ?? 0)) || clipDur;
      const entry: CatalogRow = {
        segment_id: segId,
        clip_id: clipId,
        start_sec: Math.round(segStart * 100) / 100,
        end_sec: Math.round(segEnd * 100) / 100,
        duration: Math.round(Math.max(0, segEnd - segStart) * 100) / 100,
        orientation: clipOrient,
      };
      const tags = (seg.tags ?? []).map((t) => String(t).trim()).filter(Boolean);
      if (tags.length) entry.tags = tags;
      const desc = (seg.description ?? "").trim();
      if (desc) entry.description = desc.length > 260 ? `${desc.slice(0, 257)}...` : desc;
      if (seg.concepts) {
        entry.concepts = compactConcepts(seg.concepts);
      }
      if (clipSrc) entry.source = String(clipSrc);
      out.push(entry);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Scene backfill (LLM sometimes omits scene_idx)
// ---------------------------------------------------------------------------

function backfillSceneIdx(timeline: TimelinePick[], scenes: Scene[]): void {
  if (!scenes.length) return;
  const ordered = [...scenes].sort((a, b) => a.start_sec - b.start_sec);
  for (const clip of timeline) {
    if (clip.scene_idx != null) continue;
    const a = clip.audio_start ?? 0;
    let match = ordered.find((s) => s.start_sec <= a && a < s.end_sec);
    if (!match) {
      match =
        [...ordered].reverse().find((s) => s.start_sec <= a) ?? ordered[0];
    }
    if (match) clip.scene_idx = match.idx;
  }
}

// ---------------------------------------------------------------------------
// Slim scenes payload for picker
// ---------------------------------------------------------------------------

function scenesForPicker(scenes: Scene[]) {
  return scenes
    .filter((s) => s != null)
    .map((s) => ({
      idx: s.idx,
      start_sec: s.start_sec,
      end_sec: s.end_sec,
      duration_sec: Math.round(Math.max(0, s.end_sec - s.start_sec) * 100) / 100,
      title_he: s.title_he ?? "",
      narration: s.narration ?? "",
      keywords: s.keywords ?? [],
      mood: s.mood ?? null,
      kind: s.kind ?? "prose",
      heterogeneous: s.heterogeneous ?? false,
    }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface PickerOptions {
  customPrompt?: string;
  transcriptSegments?: WhisperSegment[];
  scenes?: Scene[];
  avoidSegmentIds?: Set<string>;
  /** When set, calls validateAndSwap after each non-empty LLM timeline and may retry the LLM up to maxLlmAttempts. */
  validationContext?: PickerValidationContext;
  /** Default: 3 when validationContext is set, otherwise 1. */
  maxLlmAttempts?: number;
  /**
   * Prefix for `usage_calls` step IDs (default picks `picker_attempt_N`).
   * Replan flows should pass `replan_picker_attempt` → `replan_picker_attempt_1`, ….
   */
  usageAttemptPrefix?: string;
}

export async function pickSegments(
  transcriptText: string,
  videos: ParsedVideo[],
  durationSec: number,
  opts: PickerOptions = {}
): Promise<TimelinePick[]> {
  const result = await pickSegmentsDetailed(transcriptText, videos, durationSec, opts);
  return result.timeline;
}

const TIMELINE_PICK_SCHEMA_DESCRIPTION =
  "Hebrew weather edit: ordered timeline picks. A downstream validator rejects choices that contradict narration weather (e.g. sun for drizzle/night coastline for daytime drizzle) or break repeat/coverage rules—match weather and sky-state tags before geography. Prefer one pick per parent clip_id; at most two picks may share a clip_id only if two different segment_id rows have clearly different shot semantics (tags + Hebrew description). Every scene must have picks; segment_id must exist in the provided catalog.";

function violationTriggersPickerRetry(v: Record<string, unknown>): boolean {
  if (v.fixed !== true) return false;
  const issue = String(v.issue ?? "");
  const exact = [
    "semantic mismatch",
    "coverage gap",
    "same clip reuse",
    "consecutive duplicate",
    "recency violation",
  ];
  if (exact.some((n) => issue.includes(n))) return true;
  if (/\d+th repeat/i.test(issue) || (issue.toLowerCase().includes("repeat") && issue.includes("th")))
    return true;
  if (issue.includes("clothing")) return true;
  return false;
}

function validatorWarrantsPickerRetry(validator: ValidatorBundle): boolean {
  for (const f of validator.hard_violations_fixed) {
    if (violationTriggersPickerRetry(f as Record<string, unknown>)) return true;
  }
  return false;
}

function collectAvoidSegmentIds(
  fixes: Record<string, unknown>[],
  segmentKeys: Set<string>,
): string[] {
  const out = new Set<string>();
  for (const f of fixes) {
    if (!violationTriggersPickerRetry(f)) continue;
    const o = f.original != null ? String(f.original) : "";
    const sid = f.segment_id != null ? String(f.segment_id) : "";
    if (o && segmentKeys.has(o)) out.add(o);
    if (sid && segmentKeys.has(sid)) out.add(sid);
  }
  return [...out];
}

function buildRetryFeedback(args: {
  fixes: Record<string, unknown>[];
  rejectedSegmentIds: string[];
}): Record<string, unknown> {
  const prior = args.fixes.filter(violationTriggersPickerRetry).map((f) => ({
    issue: f.issue,
    original_segment_id: f.original ?? f.segment_id,
    swapped_to: f.swapped_to,
    swap_reason: f.swap_reason,
    previous_scene: f.previous_scene,
    current_scene: f.current_scene,
  }));
  return {
    prior_attempt_fixes: prior,
    rejected_segment_ids: [...new Set(args.rejectedSegmentIds)].sort(),
    instruction:
      "These segment_id values were statistically rejected or replaced—choose different catalog rows that satisfy weather, anti-repeat, duration coverage, and clothing rules.",
  };
}

function feedbackDigestFromValidator(validator: ValidatorBundle): string {
  const hits = validator.hard_violations_fixed.filter((f) =>
    violationTriggersPickerRetry(f as Record<string, unknown>),
  );
  return hits
    .map((f) => String((f as Record<string, unknown>).issue ?? ""))
    .filter(Boolean)
    .slice(0, 12)
    .join("; ");
}

function stampPickerReasons(timeline: TimelinePick[]): MutablePick[] {
  return timeline.map((p) => {
    const m: MutablePick = { ...p };
    const trimmed = String(p.reason ?? "").trim();
    if (trimmed) m.picker_reason = trimmed;
    return m;
  });
}

function shuffleCatalogRows(catalog: CatalogRow[]): void {
  for (let i = catalog.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
  }
}

async function invokePickerLlmOnce(args: {
  provider: ReturnType<typeof getLlmProvider>;
  transcriptText: string;
  durationSec: number;
  scenes: Scene[];
  catalog: CatalogRow[];
  customPrompt?: string;
  avoidSegmentIds?: Set<string>;
  attempt: number;
  retryFeedback?: Record<string, unknown>;
  usageStep: string;
}): Promise<PickSegmentsResult> {
  const {
    provider,
    transcriptText,
    durationSec,
    scenes,
    catalog,
    customPrompt,
    avoidSegmentIds,
    attempt,
    retryFeedback,
    usageStep,
  } =
    args;

  // Keep the system prompt byte-identical across retries so OpenAI's automatic
  // prefix cache (≥1024 tokens) and Anthropic's explicit cache_control both hit.
  // Dynamic per-attempt content goes in the user payload tail, not here.
  const systemPrompt = customPrompt?.trim() ? customPrompt.trim() : SCENE_AWARE_SYSTEM_PROMPT;

  // Drop already-rejected rows from the catalog itself — the model would never
  // pick them, and serializing them is pure waste. The instruction below acts
  // as a belt-and-suspenders safeguard.
  const effectiveCatalog =
    avoidSegmentIds && avoidSegmentIds.size > 0
      ? catalog.filter((row) => !avoidSegmentIds.has(row.segment_id))
      : catalog;

  // User payload order: static-leaning fields first (cacheable), dynamic last.
  const payload: Record<string, unknown> = {
    picking_note: PICKER_CLIP_DIVERSITY_NOTE,
    duration_sec: durationSec,
    scenes: scenesForPicker(scenes),
    catalog: effectiveCatalog,
  };
  if (avoidSegmentIds && avoidSegmentIds.size > 0) {
    payload.avoid_segment_ids = [...avoidSegmentIds].sort();
  }
  if (attempt >= 2) {
    payload.retry_mode_notes = PICKER_FALLBACK_PROMPT;
  }
  if (retryFeedback && Object.keys(retryFeedback).length > 0) {
    payload.retry_feedback = retryFeedback;
  }

  const userPayload = JSON.stringify(payload, null, 2);
  const baseStatus = (): Omit<PickerRunStatus, "state" | "usable_picks"> => ({
    provider: provider.id,
    model: provider.model,
    catalog_rows: effectiveCatalog.length,
    scenes_requested: scenes.length,
    payload_bytes: Buffer.byteLength(userPayload, "utf8"),
  });

  // System prompt is now stable across attempts — always enable caching when
  // the caller didn't override the system prompt.
  const useCache = !customPrompt;

  try {
    const { data, usage } = await provider.completeJson({
      systemPrompt,
      userPayload,
      schema: PickResponseSchema,
      schemaName: "timeline_pick_response",
      schemaDescription: TIMELINE_PICK_SCHEMA_DESCRIPTION,
      options: {
        temperature: 0.7,
        cacheSystemPrompt: useCache,
      },
    });

    const timeline = data.timeline as TimelinePick[];
    backfillSceneIdx(timeline, scenes);
    const usageRecord: UsageCallRecord = { step: usageStep, ...usage };
    if (!timeline.length) {
      return {
        timeline,
        picker_usages: [usageRecord],
        picker_status: {
          ...baseStatus(),
          state: "empty",
          usable_picks: 0,
          error_code: "picker_empty",
          error: "The picker returned an empty timeline.",
          llm_attempts_used: attempt,
        },
      };
    }
    return {
      timeline,
      picker_usages: [usageRecord],
      picker_status: {
        ...baseStatus(),
        state: "ok",
        usable_picks: timeline.length,
        llm_attempts_used: attempt,
      },
    };
  } catch (err) {
    if (err instanceof LlmProviderError) {
      if (err.code === "llm_invalid_key" || err.code === "llm_quota_exceeded") throw err;
      const status: PickerRunStatus = {
        ...baseStatus(),
        state: "failed",
        usable_picks: 0,
        error_code: err.code,
        error: sanitizePickerError(err.message),
        llm_attempts_used: attempt,
      };
      console.warn(`pickSegments: LLM call failed: ${err.message}`);
      throw new PickerFailureError("Picker LLM call failed", status, err);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`pickSegments: LLM call failed: ${msg}`);
    const status: PickerRunStatus = {
      ...baseStatus(),
      state: "failed",
      usable_picks: 0,
      error_code: "llm_unknown",
      error: sanitizePickerError(msg),
      llm_attempts_used: attempt,
    };
    throw new PickerFailureError("Picker LLM call failed", status, err);
  }
}

export async function pickSegmentsDetailed(
  transcriptText: string,
  videos: ParsedVideo[],
  durationSec: number,
  opts: PickerOptions = {},
): Promise<PickSegmentsResult> {
  const provider = getLlmProvider();

  const catalog = prepareCatalog(videos);
  shuffleCatalogRows(catalog);

  const scenes =
    opts.scenes?.length
      ? opts.scenes
      : fallbackSingleScene(transcriptText, opts.transcriptSegments ?? [], durationSec);

  const prefix = opts.usageAttemptPrefix ?? "picker_attempt";
  const maxAttempts = Math.max(1, opts.maxLlmAttempts ?? (opts.validationContext ? 3 : 1));
  const vctx = opts.validationContext;
  let cumulativeAvoid = new Set(opts.avoidSegmentIds ?? []);
  let lastRetryFeedback: Record<string, unknown> | undefined;
  const accruedPickerUsages: UsageCallRecord[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    // Intentionally do NOT reshuffle between attempts: keeping catalog row
    // order stable lets OpenAI's automatic prefix cache hit on attempts 2+
    // (the retry feedback at the payload tail is the new signal, not row order).

    const invokeResult = await invokePickerLlmOnce({
      provider,
      transcriptText,
      durationSec,
      scenes,
      catalog,
      customPrompt: opts.customPrompt,
      avoidSegmentIds: cumulativeAvoid,
      attempt,
      retryFeedback: lastRetryFeedback,
      usageStep: `${prefix}_${attempt}`,
    });

    if (invokeResult.picker_usages?.length) {
      accruedPickerUsages.push(...invokeResult.picker_usages);
    }

    const hasPicks = invokeResult.timeline.length > 0 && invokeResult.picker_status.state === "ok";

    if (!hasPicks) {
      lastRetryFeedback = {
        prior_failure: "empty_timeline",
        after_attempt: attempt,
        rejected_segment_ids: [...cumulativeAvoid].sort(),
      };
      if (attempt === maxAttempts) {
        return {
          timeline: [],
          picker_usages: accruedPickerUsages,
          picker_status: {
            ...invokeResult.picker_status,
            llm_attempts_used: attempt,
            last_retry_reason: "exhausted_llm_attempts_empty_timeline",
          },
        };
      }
      continue;
    }

    if (!vctx) {
      return {
        timeline: invokeResult.timeline,
        picker_usages: accruedPickerUsages,
        picker_status: { ...invokeResult.picker_status, llm_attempts_used: attempt },
      };
    }

    const mutable = stampPickerReasons(invokeResult.timeline);
    const validator = validateAndSwap(mutable, {
      beats: vctx.beats,
      videoMap: vctx.videoMap,
      segmentMap: vctx.segmentMap,
      scenes: vctx.scenes,
      allowSceneGapFill: vctx.allowSceneGapFill ?? mutable.length > 0,
    });

    const needsRetry = validatorWarrantsPickerRetry(validator);
    if (!needsRetry || attempt === maxAttempts) {
      const digest = feedbackDigestFromValidator(validator);
      return {
        timeline: mutable as unknown as TimelinePick[],
        validator,
        picker_usages: accruedPickerUsages,
        picker_status: {
          ...invokeResult.picker_status,
          llm_attempts_used: attempt,
          last_retry_reason:
            needsRetry && attempt === maxAttempts
              ? "exhausted_llm_attempts_validator_still_matched_swaps"
              : undefined,
          validator_feedback_digest: needsRetry && attempt === maxAttempts ? digest : undefined,
        },
      };
    }

    const segmentKeys = new Set(Object.keys(vctx.segmentMap));
    for (const id of collectAvoidSegmentIds(
      validator.hard_violations_fixed as Record<string, unknown>[],
      segmentKeys,
    )) {
      cumulativeAvoid.add(id);
    }

    lastRetryFeedback = buildRetryFeedback({
      fixes: validator.hard_violations_fixed as Record<string, unknown>[],
      rejectedSegmentIds: [...cumulativeAvoid],
    });
  }

  throw new Error("pickSegmentsDetailed: retry loop exited without return");
}

// ---------------------------------------------------------------------------
// Transcription (delegated to the active TranscriptionProvider — OpenAI
// Whisper cloud today, see src/server/providers/transcription)
// ---------------------------------------------------------------------------


export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  const provider = getTranscriptionProvider();
  return provider.transcribe(audioPath);
}

export type { TranscriptionResult } from "@/server/providers/transcription/types";
