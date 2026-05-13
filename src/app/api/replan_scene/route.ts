import { NextRequest, NextResponse } from "next/server";
import { PickerFailureError, pickSegmentsDetailed, type PickerRunStatus } from "@/server/pipeline/picker";
import { validateAndSwap, type MutablePick } from "@/server/pipeline/validator";
import type { Scene } from "@/shared/types";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";

function pickerFailureResponse(pickerStatus: PickerRunStatus, status = 502) {
  return NextResponse.json(
    {
      success: false,
      error: "בחירת הקליפ לסצינה נכשלה. הסצינה לא הוחלפה אוטומטית.",
      error_code: pickerStatus.error_code ?? "picker_failed",
      picker_status: pickerStatus,
    },
    { status },
  );
}

function buildReplanAvoidSet(
  otherPicks: Record<string, unknown>[],
  oldPicksForScene: Record<string, unknown>[],
  segmentMap: Record<string, { clip: Record<string, unknown>; segment: Record<string, unknown> }>,
): Set<string> {
  const avoid = new Set<string>();

  for (const c of otherPicks) {
    if (c.segment_id) avoid.add(c.segment_id as string);
  }

  const oldSegIds = new Set<string>();
  for (const c of oldPicksForScene) {
    if (c.segment_id) {
      avoid.add(c.segment_id as string);
      oldSegIds.add(c.segment_id as string);
    }
  }

  const oldVideoIds = new Set<string>();
  const oldFirstTags = new Set<string>();
  for (const oldId of oldSegIds) {
    const entry = segmentMap[oldId];
    if (!entry) continue;
    const clipId = (entry.clip?.id as string) || "";
    if (clipId) oldVideoIds.add(clipId);
    const tags = (entry.segment?.tags as string[]) ?? [];
    if (tags.length) {
      const first = String(tags[0]).trim().toLowerCase();
      if (first) oldFirstTags.add(first);
    }
  }

  for (const [sid, e] of Object.entries(segmentMap)) {
    const clipId = (e.clip?.id as string) || "";
    if (oldVideoIds.has(clipId)) avoid.add(sid);
    const tags = (e.segment?.tags as string[]) ?? [];
    if (tags.length && oldFirstTags.has(String(tags[0]).trim().toLowerCase())) avoid.add(sid);
  }

  avoid.delete("");
  return avoid;
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const data = (await req.json()) as Record<string, unknown>;
  const scenes = (data.scenes ?? []) as Record<string, unknown>[];
  const fullTimeline = (data.timeline ?? []) as Record<string, unknown>[];
  const jobId = data.job_id as string | undefined;
  const sceneIdxRaw = data.scene_idx;
  const pickerPrompt = data.picker_prompt as string | undefined;

  if (sceneIdxRaw == null || isNaN(Number(sceneIdxRaw))) {
    return NextResponse.json({ success: false, error: "Missing scene_idx" }, { status: 400 });
  }
  const sceneIdx = Number(sceneIdxRaw);
  if (!scenes.length) return NextResponse.json({ success: false, error: "Missing scenes[]" }, { status: 400 });
  if (!jobId) return NextResponse.json({ success: false, error: "Missing job_id" }, { status: 400 });

  const target = scenes.find((s) => Number(s.idx) === sceneIdx);
  if (!target) return NextResponse.json({ success: false, error: `Unknown scene_idx ${sceneIdx}` }, { status: 400 });

  const otherPicks = fullTimeline.filter((c) => c.scene_idx != null && Number(c.scene_idx) !== sceneIdx);
  const oldPicksForScene = fullTimeline.filter((c) => c.scene_idx != null && Number(c.scene_idx) === sceneIdx);

  try {
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const segmentMap = buildSegmentMap(videos);
    const videoMap = buildVideoMap(videos);

    const avoidSet = buildReplanAvoidSet(
      otherPicks as Record<string, unknown>[],
      oldPicksForScene as Record<string, unknown>[],
      segmentMap as unknown as Record<string, { clip: Record<string, unknown>; segment: Record<string, unknown> }>,
    );

    const audioDuration = Number(target.end_sec ?? 0) - Number(target.start_sec ?? 0);
    const pickerResult = await pickSegmentsDetailed("", videos, audioDuration, {
      customPrompt: pickerPrompt,
      transcriptSegments: [],
      scenes: [target as unknown as Scene],
      avoidSegmentIds: avoidSet,
      maxLlmAttempts: 3,
    });
    const newPicksRaw = pickerResult.timeline;
    if (!newPicksRaw.length) {
      return pickerFailureResponse(pickerResult.picker_status, 422);
    }

    const newPicks: MutablePick[] = newPicksRaw.map((p) => {
      const m: MutablePick = { ...p, scene_idx: sceneIdx };
      const trimmed = (p.reason ?? "").trim();
      if (trimmed) m.picker_reason = trimmed;
      return m;
    });

    const merged: MutablePick[] = [
      ...(otherPicks as unknown as MutablePick[]),
      ...newPicks,
    ].sort((a, b) => {
      const as_ = a.audio_start ?? 0;
      const bs_ = b.audio_start ?? 0;
      return as_ !== bs_ ? as_ - bs_ : (a.scene_idx ?? 0) - (b.scene_idx ?? 0);
    });

    const validatorResult = validateAndSwap(merged, {
      beats: [],
      videoMap,
      segmentMap,
      scenes: scenes as unknown as Scene[],
      allowSceneGapFill: newPicksRaw.length > 0,
    });

    updatePlanBundle(jobId, { timeline: merged, validator: validatorResult, picker_status: pickerResult.picker_status });

    return NextResponse.json({
      success: true,
      scene_idx: sceneIdx,
      picks: merged.filter((c) => c.scene_idx === sceneIdx),
      timeline: merged,
      validator: validatorResult,
      picker_status: pickerResult.picker_status,
    });
  } catch (err) {
    if (err instanceof PickerFailureError) return pickerFailureResponse(err.picker_status);
    const handled = mapProviderError(err);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[replan_scene]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
