import { z } from "zod";
import { fallbackSingleScene } from "./scene-planner";
import { SOURCE_VALUES } from "@/server/tag-vocab";
import { flattenConcepts } from "@/server/catalog/hebrew-taxonomy";
import { getLlmProvider, LlmProviderError } from "@/server/providers/llm";
import { getTranscriptionProvider } from "@/server/providers/transcription";
import type { Scene, WhisperSegment, TimelinePick, ParsedVideo, SegmentConcepts } from "@/shared/types";

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

**Catalog row anatomy** — Each row is one **\`segment_id\`** tied to exactly one **\`clip_id\`** (source file). Fields include Hebrew description, 1–3 keyword tags, and \`start_sec\`/\`end_sec\` (**trim controls only—do not cite time overlap or separation as proof that two segments “look different”**). Diversity of shots is inferred from **tags + description semantics**, not from timestamps alone. Tags may be vocabulary values or free-form Hebrew/English keywords; treat all tags as shot descriptors.

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
   - **\`heterogeneous: true\`** (multi-region scene) → pick **1 clip PER named region** in the narration order (typically 2 picks). Allocate the audio range proportionally to where each region appears in the narration — earlier-mentioned region gets the earlier audio sub-range. The per-region pick MUST match that region's stated weather (see A1).
   - **\`duration_sec\` < 12** → pick **1** clip covering the full audio range (\`audio_start = scene.start_sec\`, \`audio_end = scene.end_sec\`).
   - **\`duration_sec\` ≥ 12** (and not heterogeneous) → **prefer 2 picks**: a primary shot and a complementary shot. Equal-split the audio range: pick A covers \`start..mid\`, pick B covers \`mid..end\`. Default → **different \`clip_id\`** and different \`segment_id\`; use the SAME \`clip_id\` twice only under the rare **Clip reuse exception** in CORE RULES (B2). BOTH picks must still match the scene's narration.

2. **COVERAGE — each pick's segment \`duration\` MUST be ≥ its assigned audio sub-range**. Each catalog row carries a \`duration\` field; check it before picking. If no single segment covers the assigned range, pick the longest acceptable segment and the validator will split it further; never deliberately under-cover.

3. **Scene \`kind\` matters:**
   - \`prose\`      → segment(s) that visually match the scene's narration.
   - \`list\` + \`heterogeneous: false\` → ONE calm, AMBIENT shot related to the current season / general weather context (NOT a literal match to the listed facts). Temperature rolls, day-of-week recaps deserve a steady "scan-able" backdrop — a wide sky shot, a calm city skyline, a generic seasonal landscape. Do NOT cycle through individual cuts of every city/day mentioned. Lean on broad keywords like \`sky\`, \`city\`, \`clouds\`, \`calm\`, \`aerial\`, \`mountain\`. The ONE-ambient rule overrides the ≥12s 2-pick default ONLY for homogeneous lists.
   - \`list\` + \`heterogeneous: true\` → follow rule 1's per-region rule (NOT the ONE-ambient rule).
   - \`transition\` → a brief, calm cutaway that doesn't fight the narration ("ועכשיו…", "לסיכום…").

4. Each pick MUST carry the scene's \`idx\` as \`scene_idx\`. Without it, the validator cannot map picks back to scenes.

5. Each scene's \`keywords\` are SUGGESTIONS, not a whitelist. The scene's \`narration\` (Hebrew sentence) and \`mood\` are the primary signal — read them holistically, not as keyword bags.

CORE RULES

A. **Holistic interpretation, not literal keyword match.** Read the scene's narration, pick by intent.
A1. **Weather state outranks geography.** When the narration mentions a weather state (גשם / עננים / שמש / שלג / סופה / ערפל / רוח / חם / קר / שרב / חמסין), the picked segment's weather/concept signal MUST match. Wrong-weather + right-place is worse than right-weather + generic-place.
A2. **When no candidate scores high on the dominant signal, fall back to a generic AMBIENT shot that fits the weather mood** — a wide sky shot, calm city skyline, generic seasonal landscape — rather than a thematically-off specific shot.
A3. **Sky-state tags.** Match \`overcast\` to overcast/wet narration (מעונן / טפטוף / חורפי); \`clear_sky\` or \`partly_cloudy\` to sunny narration (יום בהיר / שמשי / חם). Don't pick a \`partly_cloudy + summer\` clip for an overcast scene.
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

OUTPUT — Return only \`timeline\`: an array of picks in narrative/time order, each with \`scene_idx\`, \`segment_id\`, \`audio_start\`, \`audio_end\`, optional \`video_start\`/\`video_end\` (default = segment span; system may adjust), and \`reason\`. Cover **every** scene; no omitted scenes.`;

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
  concepts?: SegmentConcepts;
  concept_terms?: string[];
  description?: string;
  source?: string;
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
      if (desc) entry.description = desc;
      if (seg.concepts) {
        entry.concepts = seg.concepts;
        const terms = flattenConcepts(seg.concepts);
        if (terms.length) entry.concept_terms = terms;
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
}

export async function pickSegments(
  transcriptText: string,
  videos: ParsedVideo[],
  durationSec: number,
  opts: PickerOptions = {}
): Promise<TimelinePick[]> {
  const provider = getLlmProvider();

  const catalog = prepareCatalog(videos);
  // Shuffle to neutralize transformer position bias
  for (let i = catalog.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [catalog[i], catalog[j]] = [catalog[j], catalog[i]];
  }

  const scenes =
    opts.scenes?.length
      ? opts.scenes
      : fallbackSingleScene(transcriptText, opts.transcriptSegments ?? [], durationSec);

  let systemPrompt =
    opts.customPrompt?.trim() ? opts.customPrompt.trim() : SCENE_AWARE_SYSTEM_PROMPT;

  if (opts.avoidSegmentIds?.size) {
    systemPrompt +=
      "\n\nADDITIONAL: do not pick any segment_id in this already-used list: " +
      [...opts.avoidSegmentIds].sort().join(", ");
  }

  const payload = {
    picking_note: PICKER_CLIP_DIVERSITY_NOTE,
    duration_sec: durationSec,
    scenes: scenesForPicker(scenes),
    catalog,
  };

  try {
    const data = await provider.completeJson({
      systemPrompt,
      userPayload: JSON.stringify(payload, null, 2),
      schema: PickResponseSchema,
      schemaName: "timeline_pick_response",
      schemaDescription:
        "Hebrew weather edit: ordered timeline picks. Prefer one pick per parent clip_id; at most two picks may share a clip_id only if two different segment_id rows have clearly different shot semantics (tags + Hebrew description). Every scene must have picks; segment_id must exist in the provided catalog.",
      options: {
        temperature: 0.7,
        cacheSystemPrompt: !opts.customPrompt && !opts.avoidSegmentIds?.size,
      },
    });

    const timeline = data.timeline as TimelinePick[];
    backfillSceneIdx(timeline, scenes);
    return timeline;
  } catch (err) {
    // Bubble auth/quota so route handlers can translate to actionable HTTP
    // responses; swallow other failures so the pipeline can fall back to
    // the deterministic single-scene timeline.
    if (err instanceof LlmProviderError) {
      if (err.code === "llm_invalid_key" || err.code === "llm_quota_exceeded") throw err;
      console.warn(`pickSegments: LLM call failed: ${err.message}`);
      return [];
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`pickSegments: LLM call failed: ${msg}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Transcription (delegated to the active TranscriptionProvider — OpenAI
// Whisper cloud today, see src/server/providers/transcription)
// ---------------------------------------------------------------------------

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  duration: number;
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  const provider = getTranscriptionProvider();
  return provider.transcribe(audioPath);
}
