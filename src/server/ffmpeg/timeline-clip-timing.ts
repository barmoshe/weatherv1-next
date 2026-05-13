import type { ResolvedPick } from "@/shared/types";

export interface NarrativeVsSourceTrim {
  /** Narration slice length (`audio_end - audio_start`); output slice matches this via pad if needed. */
  audioDur: number;
  seekStart: number;
  /** Seconds read from source at `seekStart` (≤ audioDur); may be shorter when stock trim runs out. */
  decodeDur: number;
  /** Freeze tail after decode (`audioDur - decodeDur`). */
  padDur: number;
}

/**
 * Align editor clock with narration: each stitched segment spans exactly `audioDur`.
 * Uses at most `min(video trim length, audioDur)` from stock; freezes last frame when stock is shorter.
 */
export function narrativeDecodeFromPick(clip: ResolvedPick): NarrativeVsSourceTrim {
  const audioDurRaw = clip.audio_end - clip.audio_start;
  const audioDur = Math.max(0, Number.isFinite(audioDurRaw) ? audioDurRaw : 0);
  const seekStartRaw = clip.video_start ?? 0;
  const seekStart = Math.max(0, Number.isFinite(seekStartRaw) ? seekStartRaw : 0);
  let videoEnd = clip.video_end;
  if (videoEnd == null || !Number.isFinite(videoEnd) || videoEnd <= seekStart) {
    videoEnd = seekStart + audioDur;
  }
  const videoAvail = Math.max(0, Number(videoEnd) - seekStart);
  const decodeDur = audioDur <= 0 ? 0 : Math.min(videoAvail, audioDur);
  const padDur = Math.max(0, audioDur - decodeDur);
  return { audioDur, seekStart, decodeDur, padDur };
}
