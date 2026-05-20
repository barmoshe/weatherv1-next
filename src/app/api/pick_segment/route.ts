import { NextRequest, NextResponse } from "next/server";
import { validateAndSwap, type MutablePick } from "@/server/pipeline/validator";
import type { Scene } from "@/shared/types";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";
import { recordJobFailure } from "@/server/jobs/failure";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const data = (await req.json()) as Record<string, unknown>;
  const scenes = (data.scenes ?? []) as Record<string, unknown>[];
  const fullTimeline = (data.timeline ?? []) as Record<string, unknown>[];
  const jobId = data.job_id as string | undefined;
  const sceneIdxRaw = data.scene_idx;
  const pickIndexRaw = data.pick_index;
  const newSegmentId = data.new_segment_id as string | undefined;

  if (!jobId) return NextResponse.json({ success: false, error: "Missing job_id" }, { status: 400 });
  if (!scenes.length) return NextResponse.json({ success: false, error: "Missing scenes[]" }, { status: 400 });
  if (sceneIdxRaw == null || isNaN(Number(sceneIdxRaw))) {
    return NextResponse.json({ success: false, error: "Missing scene_idx" }, { status: 400 });
  }
  if (!newSegmentId) {
    return NextResponse.json({ success: false, error: "Missing new_segment_id" }, { status: 400 });
  }

  const sceneIdx = Number(sceneIdxRaw);
  // pick_index absent / null / -1 → append mode (scene-fill from the UI). When
  // present, swap mode replaces the existing pick at that scene-relative index.
  const isAppend =
    pickIndexRaw == null || pickIndexRaw === -1 || pickIndexRaw === "-1" || isNaN(Number(pickIndexRaw));
  const pickIndex = isAppend ? -1 : Number(pickIndexRaw);

  const target = scenes.find((s) => Number(s.idx) === sceneIdx);
  if (!target) return NextResponse.json({ success: false, error: `Unknown scene_idx ${sceneIdx}` }, { status: 400 });

  try {
    const catalog = readCatalog();
    const videos = parseCatalog(catalog);
    const segmentMap = buildSegmentMap(videos);
    const videoMap = buildVideoMap(videos);

    const segEntry = (segmentMap as Record<string, { clip: { id?: string }; segment: { start_sec?: number; end_sec?: number } }>)[newSegmentId];
    if (!segEntry) {
      return NextResponse.json({ success: false, error: `Unknown segment ${newSegmentId}` }, { status: 400 });
    }

    // In swap mode, locate the absolute position of the existing pick to replace.
    // In append mode, the insertion point is either:
    //   - right after the scene's last existing pick (if any), or
    //   - right before the first pick whose scene_idx > sceneIdx (preserve order), or
    //   - at the end of the timeline (no later scenes present).
    let absoluteIdx = -1;
    let seenInScene = 0;
    let lastSceneIdx = -1;
    let firstLaterSceneIdx = -1;
    for (let i = 0; i < fullTimeline.length; i += 1) {
      const at = Number(fullTimeline[i]?.scene_idx);
      if (at === sceneIdx) {
        lastSceneIdx = i;
        if (!isAppend && seenInScene === pickIndex) {
          absoluteIdx = i;
          break;
        }
        seenInScene += 1;
      } else if (firstLaterSceneIdx < 0 && at > sceneIdx) {
        firstLaterSceneIdx = i;
      }
    }
    if (!isAppend && absoluteIdx < 0) {
      return NextResponse.json(
        { success: false, error: `Pick index ${pickIndex} not found in scene ${sceneIdx}` },
        { status: 400 },
      );
    }
    // Resolve append insertion index: prefer after last in-scene pick; otherwise
    // before the first later-scene pick; otherwise end of timeline.
    const insertAt =
      lastSceneIdx >= 0
        ? lastSceneIdx + 1
        : firstLaterSceneIdx >= 0
          ? firstLaterSceneIdx
          : fullTimeline.length;

    // Audio range:
    //  - swap: keep the existing pick's range so the manual choice replaces it 1:1.
    //  - append, empty scene: cover the whole scene.
    //  - append, scene already has picks: cover from the last pick's audio_end
    //    to the scene end (i.e., append into the remaining tail). If nothing
    //    remains, fall back to the scene's full range — the validator will
    //    handle the overlap.
    let audioStart: number;
    let audioEnd: number;
    if (isAppend) {
      const sceneStart = Number(target.start_sec ?? 0);
      const sceneEnd = Number(target.end_sec ?? sceneStart);
      const lastEnd = lastSceneIdx >= 0 ? Number(fullTimeline[lastSceneIdx]?.audio_end ?? sceneStart) : sceneStart;
      const tailStart = Math.max(sceneStart, Math.min(lastEnd, sceneEnd));
      audioStart = tailStart < sceneEnd ? tailStart : sceneStart;
      audioEnd = sceneEnd;
    } else {
      const oldPick = fullTimeline[absoluteIdx];
      audioStart = Number(oldPick.audio_start ?? target.start_sec ?? 0);
      audioEnd = Number(oldPick.audio_end ?? target.end_sec ?? 0);
    }
    const audioDur = Math.max(0, audioEnd - audioStart);

    const segStart = Number(segEntry.segment.start_sec ?? 0);
    const segEnd = Number(segEntry.segment.end_sec ?? segStart + audioDur);
    const videoStart = segStart;
    const videoEnd = Math.min(segEnd, segStart + audioDur);

    const newPick: MutablePick = {
      scene_idx: sceneIdx,
      segment_id: newSegmentId,
      video_id: segEntry.clip?.id,
      audio_start: audioStart,
      audio_end: audioEnd,
      video_start: videoStart,
      video_end: videoEnd,
      reason: "manual selection",
      picker_reason: "בחירה ידנית",
    };

    const sourceTimeline = fullTimeline as unknown as MutablePick[];
    const merged: MutablePick[] = isAppend
      ? [...sourceTimeline.slice(0, insertAt), newPick, ...sourceTimeline.slice(insertAt)]
      : sourceTimeline.map((p, i) => (i === absoluteIdx ? newPick : p));

    const validatorResult = validateAndSwap(merged, {
      beats: [],
      videoMap,
      segmentMap,
      scenes: scenes as unknown as Scene[],
      allowSceneGapFill: false,
    });

    await updatePlanBundle(jobId, { timeline: merged, validator: validatorResult });

    return NextResponse.json({
      success: true,
      scene_idx: sceneIdx,
      picks: merged.filter((c) => c.scene_idx === sceneIdx),
      timeline: merged,
      validator: validatorResult,
    });
  } catch (err) {
    const handled = mapProviderError(err);
    if (jobId) recordJobFailure(jobId, "picker", err, handled);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[pick_segment]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
