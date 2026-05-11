import { NextRequest, NextResponse } from "next/server";
import { planScenes, fallbackSingleScene } from "@/server/pipeline/scene-planner";
import { pickSegments } from "@/server/pipeline/picker";
import { validateAndSwap, type MutablePick } from "@/server/pipeline/validator";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import type { Scene } from "@/shared/types";

function openaiErrorResponse(err: unknown): [Record<string, unknown>, number] | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (["insufficient_quota", "exceeded your current quota"].some((m) => msg.includes(m))) {
    return [{ success: false, error: "אזל מאגר ה-OpenAI tokens.", error_code: "openai_quota_exceeded", console_url: "https://platform.openai.com/account/billing" }, 402];
  }
  if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
    return [{ success: false, error: "מפתח OpenAI לא תקין.", error_code: "openai_invalid_key" }, 401];
  }
  return null;
}

export async function POST(req: NextRequest) {
  const data = (await req.json()) as Record<string, unknown>;
  const transcript = data.transcript as string | undefined;
  const duration = Number(data.duration ?? 0);
  const jobId = data.job_id as string | undefined;
  const customPickerPrompt = (data.picker_prompt ?? data.system_prompt) as string | undefined;
  const customScenePrompt = data.scene_prompt as string | undefined;
  const transcriptSegments = (data.transcript_segments ?? []) as Array<{ idx: number; start: number; end: number; text: string }>;
  const skipScenes = Boolean(data.skip_scenes);

  if (!transcript) return NextResponse.json({ success: false, error: "Missing transcript" }, { status: 400 });
  if (!jobId) return NextResponse.json({ success: false, error: "Missing job_id" }, { status: 400 });

  try {
    // Reload catalog so direct disk writes propagate without restart
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const segmentMap = buildSegmentMap(videos);
    const videoMap = buildVideoMap(videos);

    let scenes: Scene[] = [];
    if (!skipScenes) {
      try {
        scenes = await planScenes(transcript, transcriptSegments, duration, customScenePrompt);
      } catch (e) {
        const handled = openaiErrorResponse(e);
        if (handled) throw e; // bubble quota/auth errors
        console.warn("[plan] scene_planner failed, falling back:", e);
        scenes = [];
      }
    }
    if (!scenes.length) {
      scenes = fallbackSingleScene(transcript, transcriptSegments, duration);
    }

    const rawTimeline = await pickSegments(transcript, videos, duration, {
      customPrompt: customPickerPrompt,
      transcriptSegments,
      scenes,
    });

    const timeline: MutablePick[] = rawTimeline.map((p) => ({ ...p }));
    const validatorResult = validateAndSwap(timeline, {
      beats: transcriptSegments.map((s, i) => ({ idx: i, start: s.start, end: s.end, text: s.text })),
      videoMap,
      segmentMap,
      scenes,
    });

    updatePlanBundle(jobId, {
      scenes,
      timeline,
      validator: validatorResult,
      system_prompt: data.system_prompt,
    });

    return NextResponse.json({ success: true, scenes, timeline, validator: validatorResult });
  } catch (err) {
    const handled = openaiErrorResponse(err);
    if (handled) return NextResponse.json(handled[0], { status: handled[1] });
    console.error("[plan]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
