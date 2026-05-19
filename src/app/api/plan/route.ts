import { NextRequest, NextResponse } from "next/server";
import {
  planScenes,
  planScenesVer2,
  fallbackSingleScene,
} from "@/server/pipeline/scene-planner";
import {
  PickerFailureError,
  pickSegmentsDetailed,
  pickWithShortlists,
  type PickerRunStatus,
} from "@/server/pipeline/picker";
import { validateAndSwap, type MutablePick, type ValidatorBundle } from "@/server/pipeline/validator";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";
import type { Scene, ShortlistEntry } from "@/shared/types";
import type { LlmCallUsage, UsageCallRecord } from "@/shared/usage";
import { persistPlanUsage } from "@/server/jobs/usage-persist";
import { retrieveCandidates } from "@/server/pipeline/retrieve";
import { applyCoverageSplit, type CoveragePick } from "@/server/pipeline/coverage";

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

function isVer2Enabled(): boolean {
  return process.env.PLAN_PIPELINE_VER2 === "1";
}

function generateRenderSeed(): number {
  // 16-bit seed is plenty — large enough for variety, small enough to be human-readable in logs.
  return (Math.floor(Math.random() * 0xffff) + 1) & 0xffff;
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
  const requestedRenderSeed =
    typeof data.render_seed === "number" && Number.isFinite(data.render_seed)
      ? Math.max(1, Math.floor(data.render_seed)) & 0xffff
      : undefined;

  if (!transcript) return NextResponse.json({ success: false, error: "Missing transcript" }, { status: 400 });
  if (!jobId) return NextResponse.json({ success: false, error: "Missing job_id" }, { status: 400 });

  if (isVer2Enabled()) {
    return handleVer2({
      jobId,
      transcript,
      duration,
      transcriptSegments,
      customScenePrompt,
      customPickerPrompt,
      skipScenes,
      renderSeed: requestedRenderSeed ?? generateRenderSeed(),
      systemPromptForBundle: data.system_prompt as string | undefined,
    });
  }

  // Ver1 — original pipeline
  try {
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const segmentMap = buildSegmentMap(videos);
    const videoMap = buildVideoMap(videos);

    let scenes: Scene[] = [];
    let scenePlannerUsage: LlmCallUsage | undefined;
    if (!skipScenes) {
      try {
        const planned = await planScenes(transcript, transcriptSegments, duration, customScenePrompt);
        scenes = planned.scenes;
        scenePlannerUsage = planned.usage;
      } catch (e) {
        const handled = mapProviderError(e);
        if (handled) throw e;
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
        quality: "ship",
        hard_violations_fixed: [],
        hard_violations_kept: [],
        warnings: [],
        gap_filled: [],
        catalog_health: {},
      };
    }

    await updatePlanBundle(jobId, {
      scenes,
      timeline,
      validator: validatorResult,
      picker_status: pickerResult.picker_status,
      system_prompt: data.system_prompt,
    });

    persistPlanUsage(jobId, scenePlannerUsage, pickerResult.picker_usages ?? []);

    return NextResponse.json({ success: true, scenes, timeline, validator: validatorResult, picker_status: pickerResult.picker_status });
  } catch (err) {
    if (err instanceof PickerFailureError) return pickerFailureResponse(err.picker_status);
    const handled = mapProviderError(err);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[plan]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}

interface Ver2Args {
  jobId: string;
  transcript: string;
  duration: number;
  transcriptSegments: Array<{ idx: number; start: number; end: number; text: string }>;
  customScenePrompt?: string;
  customPickerPrompt?: string;
  skipScenes: boolean;
  renderSeed: number;
  systemPromptForBundle?: string;
}

async function handleVer2(args: Ver2Args): Promise<NextResponse> {
  const {
    jobId,
    transcript,
    duration,
    transcriptSegments,
    customScenePrompt,
    customPickerPrompt,
    skipScenes,
    renderSeed,
    systemPromptForBundle,
  } = args;

  try {
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);

    let scenes: Scene[] = [];
    let scenePlannerUsage: LlmCallUsage | undefined;
    if (!skipScenes) {
      try {
        const planned = await planScenesVer2(transcript, transcriptSegments, duration, customScenePrompt);
        scenes = planned.scenes;
        scenePlannerUsage = planned.usage;
      } catch (e) {
        const handled = mapProviderError(e);
        if (handled) throw e;
        console.warn("[plan ver2] scene_planner failed, falling back:", e);
        scenes = [];
      }
    }
    if (!scenes.length) {
      scenes = fallbackSingleScene(transcript, transcriptSegments, duration);
    }

    // Retrieve shortlists per scene
    const shortlistsByScene: Record<number, ShortlistEntry[]> = {};
    const thinScenes: number[] = [];
    for (const scene of scenes) {
      const { shortlist, shortlist_thin } = retrieveCandidates(scene, videos, {
        renderSeed,
      });
      shortlistsByScene[scene.idx] = shortlist;
      if (shortlist_thin) thinScenes.push(scene.idx);
    }

    const pickerResult = await pickWithShortlists(scenes, duration, {
      renderSeed,
      shortlistsByScene,
      thinScenes,
      customPrompt: customPickerPrompt,
    });

    if (scenes.length && pickerResult.timeline.length === 0) {
      return pickerFailureResponse(pickerResult.picker_status, 422);
    }

    // Stamp picker_reason from picker output, then run mechanical coverage split.
    const timeline: CoveragePick[] = pickerResult.timeline.map((p) => {
      const m: CoveragePick = { ...p };
      const trimmed = (p.reason ?? "").trim();
      if (trimmed) m.picker_reason = trimmed;
      return m;
    });

    const { fixes: coverageFixes } = applyCoverageSplit(timeline, shortlistsByScene);

    const persistedUsages: UsageCallRecord[] = pickerResult.picker_usages ?? [];

    await updatePlanBundle(jobId, {
      pipeline: "ver2",
      render_seed: renderSeed,
      scenes,
      timeline,
      shortlists: shortlistsByScene,
      thin_scenes: thinScenes,
      self_audit: pickerResult.self_audit,
      coverage_fixes: coverageFixes,
      picker_status: pickerResult.picker_status,
      system_prompt: systemPromptForBundle,
    });

    persistPlanUsage(jobId, scenePlannerUsage, persistedUsages);

    return NextResponse.json({
      success: true,
      pipeline: "ver2",
      render_seed: renderSeed,
      scenes,
      timeline,
      self_audit: pickerResult.self_audit,
      thin_scenes: thinScenes,
      picker_status: pickerResult.picker_status,
    });
  } catch (err) {
    if (err instanceof PickerFailureError) return pickerFailureResponse(err.picker_status);
    const handled = mapProviderError(err);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[plan ver2]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
