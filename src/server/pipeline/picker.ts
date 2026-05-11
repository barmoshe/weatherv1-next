import OpenAI from "openai";
import { z } from "zod";
import { fallbackSingleScene } from "./scene-planner";
import { SOURCE_VALUES } from "@/server/tag-vocab";
import type { Scene, WhisperSegment, TimelinePick, ParsedVideo } from "@/shared/types";

// ---------------------------------------------------------------------------
// Scene-aware system prompt
// ---------------------------------------------------------------------------

export const SCENE_AWARE_SYSTEM_PROMPT = `You are a video editor for short Hebrew weather forecasts. The narration has already been split into ordered SCENES (semantic narration blocks). Your job: for EACH scene, pick 1 or 2 catalog segments (see pick-count rule below) that visually fit.

Each catalog row is a CLIP SEGMENT — a portion of a source video with its own Hebrew description, 1–3 keyword tags, and \`start_sec\`/\`end_sec\` timecode range. Tags can be from a small general vocabulary OR free-form Hebrew/English keywords. Treat ALL tags as plain keywords describing the shot.

Suggested vocabulary (schema v2 — 7 axes you'll see in segment tags):
  weather: rain, storm, snow, hail, fog, wind, clear_sky, partly_cloudy, overcast
  light:   dawn, day, midday, golden_hour, dusk, night
  climate: hot, warm, mild, cool, cold, summer, winter, inbetween
  scenery: urban, nature, sea, mountain, aerial, indoor
  region:  north, center, south, coast, inland, negev, arava, golan, galilee, hermon, kinneret, dead-sea, eilat
  people:  people, kids, crowd, clothing
  vibe:    calm, dramatic, gloomy, cheerful
  (Regions anchor on weather-forecast geography — never expect to see city names like \`tel-aviv\`. A Tel Aviv-looking aerial is tagged \`center\` + \`coast\`. Eilat / Hermon / Kinneret / Dead-Sea are region names that the forecast calls out by name, so they're tagged as themselves.)

Source values (clip-level attribution):
  ${SOURCE_VALUES.join(", ")}

PER-SCENE PICKING RULES

1. **Pick count per scene** — pick exactly the number of clips appropriate to the scene's duration and kind:
   - **\`heterogeneous: true\`** (multi-region scene) → pick **1 clip PER named region** in the narration order (typically 2 picks). Allocate the audio range proportionally to where each region appears in the narration — earlier-mentioned region gets the earlier audio sub-range. The per-region pick MUST match that region's stated weather (see A1).
   - **\`duration_sec\` < 12** → pick **1** clip covering the full audio range (\`audio_start = scene.start_sec\`, \`audio_end = scene.end_sec\`).
   - **\`duration_sec\` ≥ 12** (and not heterogeneous) → **prefer 2 picks**: a primary shot and a complementary shot. Equal-split the audio range: pick A covers \`start..mid\`, pick B covers \`mid..end\`. The two picks should be visually distinct (different \`segment_id\`, ideally different parent clips) and BOTH match the scene's narration.

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
A1. **Weather state outranks geography.** When the narration mentions a weather state (rain / clouds / sun / snow / storm / fog / wind / hot / cold — including Hebrew variants like טפטוף / מעונן / חמסין), the picked segment's weather signal MUST match. Wrong-weather + right-place is worse than right-weather + generic-place.
A2. **When no candidate scores high on the dominant signal, fall back to a generic AMBIENT shot that fits the weather mood** — a wide sky shot, calm city skyline, generic seasonal landscape — rather than a thematically-off specific shot.
A3. **Sky-state tags.** Match \`overcast\` to overcast/wet narration (מעונן / טפטוף / חורפי); \`clear_sky\` or \`partly_cloudy\` to sunny narration (יום בהיר / שמשי / חם). Don't pick a \`partly_cloudy + summer\` clip for an overcast scene.
B. **Anti-repeat**: a \`segment_id\` appears at most twice across the whole timeline; never within 2 scenes of its previous use.
C. **Clothing rule**: only pick a clothing-tagged segment (coat / fur / scarf / sandals / swimsuit / umbrella) when the scene's narration is **explicitly about what to wear** ("מבחינת לבוש", "ללבוש"). For weather narration pick a landscape / urban / aerial / nature alternative instead.
D. **Tagged beats untagged**, but a good untagged pick beats no segment.
E. **Source preference** (soft): prefer \`original\` when the narration is local-color editorial. Otherwise tag-fit wins.
F. **\`reason\`** is one short Hebrew sentence — what's in the segment that fits the scene.
G. **Sub-range picking**: by default, set \`video_start\` = the segment's \`start_sec\` and \`video_end\` = \`start_sec\` + (audio_end - audio_start). Only use a different sub-range if you specifically want a portion of the segment.
H. **Variety across renders**: when two or more candidates score comparably, prefer the less-obvious one. Running the same forecast twice should NOT produce identical picks. Treat the catalog as a deck to deal from, not a list to scan top-down.

OUTPUT: a JSON object with key \`timeline\` containing an array of picks, each with: \`scene_idx\`, \`segment_id\`, \`audio_start\`, \`audio_end\`, \`video_start\`, \`video_end\`, \`reason\`. (You may omit \`video_start\`/\`video_end\` to default to the segment's range; the system will fill them in.) Include picks for ALL scenes in order.`;

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
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  const client = new OpenAI({ apiKey });

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
    duration_sec: durationSec,
    scenes: scenesForPicker(scenes),
    catalog,
  };

  try {
    const response = await client.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(payload, null, 2) },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
    });

    const content = response.choices[0]?.message?.content ?? "{}";
    const raw = JSON.parse(content);

    // Zod-validate (Risk A5)
    const parsed = PickResponseSchema.safeParse(raw);
    if (!parsed.success) {
      console.error("picker: LLM response failed zod validation:", parsed.error.format());
      console.error("raw response:", JSON.stringify(raw, null, 2));
      return [];
    }

    const timeline = parsed.data.timeline as TimelinePick[];
    backfillSceneIdx(timeline, scenes);
    return timeline;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("invalid_api_key") || msg.includes("authentication")) throw err;
    if (msg.includes("insufficient_quota") || msg.includes("exceeded_quota")) throw err;
    console.warn(`pickSegments: LLM call failed: ${msg}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Whisper transcription
// ---------------------------------------------------------------------------

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  duration: number;
}

export async function transcribeAudio(audioPath: string): Promise<TranscriptionResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required");

  const { WHISPER_HE_PROMPT, fixTranscript } = await import("./transcript-fixes");
  const client = new OpenAI({ apiKey });
  const fs = await import("node:fs");

  const audioStream = fs.createReadStream(audioPath);
  const transcript = await client.audio.transcriptions.create({
    model: "whisper-1",
    file: audioStream,
    response_format: "verbose_json",
    language: "he",
    prompt: WHISPER_HE_PROMPT,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const raw = transcript as unknown as {
    text: string;
    segments?: Array<{ start: number; end: number; text: string }>;
    duration?: number;
  };

  const fixedText = fixTranscript(raw.text ?? "");
  const segments: WhisperSegment[] = (raw.segments ?? []).map((s, i) => ({
    idx: i,
    start: s.start,
    end: s.end,
    text: fixTranscript(s.text ?? ""),
  }));

  const duration =
    raw.duration ??
    (segments.length ? segments[segments.length - 1].end : 0);

  return { text: fixedText, segments, duration };
}
