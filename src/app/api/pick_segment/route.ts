import { NextRequest, NextResponse } from "next/server";
import { validateAndSwap, type MutablePick } from "@/server/pipeline/validator";
import type { Scene } from "@/shared/types";
import { readCatalog } from "@/server/catalog/storage";
import { parseCatalog, buildSegmentMap, buildVideoMap } from "@/server/catalog/parser";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";

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
  if (pickIndexRaw == null || isNaN(Number(pickIndexRaw))) {
    return NextResponse.json({ success: false, error: "Missing pick_index" }, { status: 400 });
  }
  if (!newSegmentId) {
    return NextResponse.json({ success: false, error: "Missing new_segment_id" }, { status: 400 });
  }

  const sceneIdx = Number(sceneIdxRaw);
  const pickIndex = Number(pickIndexRaw);

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

    // Locate the absolute position of the target pick within the full timeline.
    let absoluteIdx = -1;
    let seenInScene = 0;
    for (let i = 0; i < fullTimeline.length; i += 1) {
      if (Number(fullTimeline[i]?.scene_idx) === sceneIdx) {
        if (seenInScene === pickIndex) {
          absoluteIdx = i;
          break;
        }
        seenInScene += 1;
      }
    }
    if (absoluteIdx < 0) {
      return NextResponse.json(
        { success: false, error: `Pick index ${pickIndex} not found in scene ${sceneIdx}` },
        { status: 400 },
      );
    }

    const oldPick = fullTimeline[absoluteIdx];
    const audioStart = Number(oldPick.audio_start ?? target.start_sec ?? 0);
    const audioEnd = Number(oldPick.audio_end ?? target.end_sec ?? 0);
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

    const merged: MutablePick[] = (fullTimeline as unknown as MutablePick[]).map((p, i) =>
      i === absoluteIdx ? newPick : p,
    );

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
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[pick_segment]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
