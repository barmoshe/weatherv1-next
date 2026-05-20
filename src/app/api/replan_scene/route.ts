import { NextRequest, NextResponse } from "next/server";
import { PickerFailureError, pickSegmentsDetailed, type PickerRunStatus } from "@/server/pipeline/picker";
import { validateAndSwap, type MutablePick } from "@/server/pipeline/validator";
import type { Scene } from "@/shared/types";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { persistReplanPickerUsage } from "@/server/jobs/usage-persist";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";
import { recordJobFailure, recordPickerFailure } from "@/server/jobs/failure";

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
  const pickIndexRaw = data.pick_index;

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

  // Per-pick AI swap mode: narrow the scene's audio window to just the targeted pick's slot
  // and keep its sibling picks untouched. Returned response shape is identical to scene-wide replan.
  const pickIndex = pickIndexRaw != null && !isNaN(Number(pickIndexRaw)) ? Number(pickIndexRaw) : null;
  const singlePickMode = pickIndex != null;
  if (singlePickMode && (pickIndex < 0 || pickIndex >= oldPicksForScene.length)) {
    return NextResponse.json(
      { success: false, error: `Pick index ${pickIndex} not found in scene ${sceneIdx}` },
      { status: 400 },
    );
  }
  const targetedPick = singlePickMode ? oldPicksForScene[pickIndex] : null;
  const siblingPicksInScene = singlePickMode
    ? oldPicksForScene.filter((_, i) => i !== pickIndex)
    : [];

  try {
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const segmentMap = buildSegmentMap(videos);
    const videoMap = buildVideoMap(videos);

    // In per-pick mode, sibling picks stay; only the targeted pick's segment_id is excluded
    // (plus the always-excluded cross-scene picks). In full-scene mode, all in-scene old picks
    // are excluded so the picker can't reuse them.
    const avoidSet = buildReplanAvoidSet(
      [...otherPicks, ...siblingPicksInScene] as Record<string, unknown>[],
      (singlePickMode ? (targetedPick ? [targetedPick] : []) : oldPicksForScene) as Record<string, unknown>[],
      segmentMap as unknown as Record<string, { clip: Record<string, unknown>; segment: Record<string, unknown> }>,
    );

    // In per-pick mode, narrow the scene clone's audio window to the single targeted pick.
    const sceneForPicker = singlePickMode && targetedPick
      ? {
          ...target,
          start_sec: Number(targetedPick.audio_start ?? target.start_sec ?? 0),
          end_sec: Number(targetedPick.audio_end ?? target.end_sec ?? 0),
        }
      : target;
    const audioDuration = Number(sceneForPicker.end_sec ?? 0) - Number(sceneForPicker.start_sec ?? 0);
    const pickerResult = await pickSegmentsDetailed("", videos, audioDuration, {
      customPrompt: pickerPrompt,
      transcriptSegments: [],
      scenes: [sceneForPicker as unknown as Scene],
      avoidSegmentIds: avoidSet,
      maxLlmAttempts: 3,
      usageAttemptPrefix: "replan_picker_attempt",
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

    // Merge into the full timeline.
    // - Per-pick mode: overwrite only the targeted slot (n-th pick of the scene) by absolute index.
    // - Full-scene mode: drop all in-scene picks, append the new ones, then sort.
    let merged: MutablePick[];
    if (singlePickMode) {
      const replacement: MutablePick = { ...newPicks[0], scene_idx: sceneIdx };
      const result = [...(fullTimeline as unknown as MutablePick[])];
      let seen = 0;
      for (let i = 0; i < result.length; i += 1) {
        if (Number(result[i]?.scene_idx) === sceneIdx) {
          if (seen === pickIndex) {
            result[i] = replacement;
            break;
          }
          seen += 1;
        }
      }
      merged = result;
    } else {
      merged = [
        ...(otherPicks as unknown as MutablePick[]),
        ...newPicks,
      ].sort((a, b) => {
        const as_ = a.audio_start ?? 0;
        const bs_ = b.audio_start ?? 0;
        return as_ !== bs_ ? as_ - bs_ : (a.scene_idx ?? 0) - (b.scene_idx ?? 0);
      });
    }

    const validatorResult = validateAndSwap(merged, {
      beats: [],
      videoMap,
      segmentMap,
      scenes: scenes as unknown as Scene[],
      // Per-pick swaps shouldn't trigger gap fills across other scenes — the user is editing one slot.
      allowSceneGapFill: !singlePickMode && newPicksRaw.length > 0,
    });

    await updatePlanBundle(jobId, { timeline: merged, validator: validatorResult, picker_status: pickerResult.picker_status });

    persistReplanPickerUsage(jobId, pickerResult.picker_usages ?? []);

    return NextResponse.json({
      success: true,
      scene_idx: sceneIdx,
      picks: merged.filter((c) => c.scene_idx === sceneIdx),
      timeline: merged,
      validator: validatorResult,
      picker_status: pickerResult.picker_status,
    });
  } catch (err) {
    if (err instanceof PickerFailureError) {
      recordPickerFailure(jobId, err.picker_status, "בחירת הקליפ לסצינה נכשלה.");
      return pickerFailureResponse(err.picker_status);
    }
    const handled = mapProviderError(err);
    recordJobFailure(jobId, "picker", err, handled);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[replan_scene]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
