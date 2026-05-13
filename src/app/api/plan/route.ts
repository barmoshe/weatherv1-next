import { NextRequest, NextResponse } from "next/server";
import { planScenes, fallbackSingleScene } from "@/server/pipeline/scene-planner";
import { PickerFailureError, pickSegmentsDetailed, type PickerRunStatus } from "@/server/pipeline/picker";
import { validateAndSwap, type MutablePick, type ValidatorBundle } from "@/server/pipeline/validator";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";
import type { Scene } from "@/shared/types";

function pickerFailureResponse(pickerStatus: PickerRunStatus, status = 502) {
  return NextResponse.json(
    {
      success: false,
      error: "בחירת הקליפים נכשלה. לא נוצר ציר זמן אוטומטי כדי לא להציג בחירות מטעות.",
      error_code: pickerStatus.error_code ?? "picker_failed",
      picker_status: pickerStatus,
    },
    { status },
  );
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

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
        const handled = mapProviderError(e);
        if (handled) throw e; // bubble quota/auth errors
        console.warn("[plan] scene_planner failed, falling back:", e);
        scenes = [];
      }
    }
    if (!scenes.length) {
      scenes = fallbackSingleScene(transcript, transcriptSegments, duration);
    }

    const pickerResult = await pickSegmentsDetailed(transcript, videos, duration, {
      customPrompt: customPickerPrompt,
      transcriptSegments,
      scenes,
      validationContext: {
        segmentMap,
        videoMap,
        scenes,
        beats: transcriptSegments.map((s, i) => ({ idx: i, start: s.start, end: s.end, text: s.text })),
      },
    });
    const rawTimeline = pickerResult.timeline;
    if (scenes.length && rawTimeline.length === 0) {
      return pickerFailureResponse(pickerResult.picker_status, 422);
    }

    const timeline: MutablePick[] = rawTimeline.map((p) => {
      const m: MutablePick = { ...p };
      const trimmed = (p.reason ?? "").trim();
      if (trimmed) m.picker_reason = trimmed;
      return m;
    });
    let validatorResult = pickerResult.validator;
    if (!validatorResult && rawTimeline.length > 0) {
      validatorResult = validateAndSwap(timeline, {
        beats: transcriptSegments.map((s, i) => ({ idx: i, start: s.start, end: s.end, text: s.text })),
        videoMap,
        segmentMap,
        scenes,
        allowSceneGapFill: rawTimeline.length > 0,
      });
    }
    if (!validatorResult) {
      validatorResult = {
        score: 100,
        hard_violations_fixed: [],
        hard_violations_kept: [],
        warnings: [],
        gap_filled: [],
        catalog_health: {},
      };
    }

    updatePlanBundle(jobId, {
      scenes,
      timeline,
      validator: validatorResult,
      picker_status: pickerResult.picker_status,
      system_prompt: data.system_prompt,
    });

    return NextResponse.json({ success: true, scenes, timeline, validator: validatorResult, picker_status: pickerResult.picker_status });
  } catch (err) {
    if (err instanceof PickerFailureError) return pickerFailureResponse(err.picker_status);
    const handled = mapProviderError(err);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[plan]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
