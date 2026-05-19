/**
 * Ver2 mechanical coverage — split & residual.
 *
 * If an LLM-picked segment is shorter than the audio range it was assigned to,
 * keep the original at the head of the scene and insert a residual segment
 * from the same scene's shortlist (next-best by score, excluding picks
 * already placed in this scene) to cover the tail. Pure video-editing math;
 * no editorial judgement, no LLM calls.
 *
 * Extracted from the ver1 validator's `enforceCoverage` Strategy 2 (split +
 * residual) so we can keep that mechanic when the editorial validator goes
 * away.
 */

import type { ShortlistEntry } from "@/shared/types";

const COVERAGE_GAP_TOLERANCE = 0.5;

export interface CoveragePick {
  scene_idx?: number | null;
  segment_id?: string;
  video_id?: string;
  audio_start: number;
  audio_end: number;
  video_start?: number;
  video_end?: number;
  reason?: string;
  picker_reason?: string;
  fallback_reason?: string;
}

export interface CoverageFix {
  scene_idx?: number;
  original?: string;
  residual?: string;
  reason: string;
}

function audioLen(p: CoveragePick): number {
  return (p.audio_end ?? 0) - (p.audio_start ?? 0);
}

function videoLen(p: CoveragePick): number {
  const start = p.video_start;
  const end = p.video_end;
  if (typeof start !== "number" || typeof end !== "number") return audioLen(p);
  return end - start;
}

export function applyCoverageSplit(
  timeline: CoveragePick[],
  shortlistsByScene: Record<number, ShortlistEntry[]>,
): { timeline: CoveragePick[]; fixes: CoverageFix[] } {
  const inserts: Array<[number, CoveragePick]> = [];
  const fixes: CoverageFix[] = [];

  for (let i = 0; i < timeline.length; i++) {
    const clip = timeline[i];
    const aLen = audioLen(clip);
    const vLen = videoLen(clip);
    const gap = aLen - vLen;
    if (gap <= COVERAGE_GAP_TOLERANCE) continue;

    const residualAudioStart = (clip.audio_start ?? 0) + vLen;
    const residualAudioEnd = clip.audio_end ?? 0;
    const residualLen = residualAudioEnd - residualAudioStart;
    if (residualLen <= 0) continue;

    const sidx = clip.scene_idx ?? null;
    const shortlist = sidx != null ? shortlistsByScene[sidx] ?? [] : [];
    const usedInScene = new Set<string>();
    for (const p of timeline) {
      if (p.scene_idx === sidx && p.segment_id) usedInScene.add(p.segment_id);
    }
    const replacement = shortlist.find(
      (s) => !usedInScene.has(s.segment_id) && s.segment_id !== clip.segment_id,
    );
    if (!replacement) {
      fixes.push({
        scene_idx: sidx ?? undefined,
        original: clip.segment_id,
        reason: "no shortlist alternative available for residual",
      });
      continue;
    }

    clip.audio_end = Math.round(residualAudioStart * 100) / 100;
    const newSegStart = replacement.start_sec;
    const newSegEnd = replacement.end_sec;
    const residualPick: CoveragePick = {
      scene_idx: clip.scene_idx,
      segment_id: replacement.segment_id,
      video_id: replacement.clip_id,
      audio_start: Math.round(residualAudioStart * 100) / 100,
      audio_end: Math.round(residualAudioEnd * 100) / 100,
      video_start: newSegStart,
      video_end: Math.min(newSegEnd, newSegStart + residualLen),
      reason: "coverage: residual fill from shortlist",
      fallback_reason: replacement.description?.trim() || undefined,
    };
    inserts.push([i + 1, residualPick]);
    fixes.push({
      scene_idx: sidx ?? undefined,
      original: clip.segment_id,
      residual: replacement.segment_id,
      reason: `split: ${vLen.toFixed(1)}s original + ${residualLen.toFixed(1)}s residual`,
    });
  }

  for (const [atIdx, pick] of [...inserts].reverse()) {
    timeline.splice(atIdx, 0, pick);
  }
  return { timeline, fixes };
}
