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

/**
 * Source in/out window (seconds) for a pick when bundling/exporting the clip.
 * Mirrors the renderer: with no explicit `video_start`/`video_end` (the common
 * case — the range lives on the catalog segment) it reads `[0, audioDur]`.
 * Clamped to the real file duration so an FCP7 `<out>` never exceeds the media.
 */
export function clipSourceWindow(
  clip: ResolvedPick,
  fileDurationSec: number,
): { inSec: number; outSec: number } {
  const { seekStart, audioDur } = narrativeDecodeFromPick(clip);
  const wantedOut = seekStart + audioDur;
  const outSec = fileDurationSec > 0 ? Math.min(wantedOut, fileDurationSec) : wantedOut;
  return { inSec: seekStart, outSec };
}

export interface ClipTrimWindow {
  /** ffmpeg extract bounds in ORIGINAL source coordinates. */
  trimStartSec: number;
  trimEndSec: number;
  /** Planned cut in/out RELATIVE to the trimmed file — what the FCP7 in/out point at. */
  inSec: number;
  outSec: number;
  /** Duration of the trimmed file (`trimEndSec - trimStartSec`). */
  fileDurationSec: number;
}

/**
 * Trim window for a pick when the export bundles a *clipped* segment instead of
 * the whole source: the planned cut (`clipSourceWindow`) padded by `handleSec`
 * on each side so the editor keeps a second of slack to nudge either edge.
 * Handles are clamped to the real media bounds, so a cut at the very start/end
 * simply gets a shorter handle on that side. The returned in/out are rebased to
 * the trimmed file's clock (the planned cut sits ~`handleSec` in from the head).
 */
export function clipTrimWindow(
  clip: ResolvedPick,
  fileDurationSec: number,
  handleSec = 1,
): ClipTrimWindow {
  const { inSec: cutIn, outSec: cutOut } = clipSourceWindow(clip, fileDurationSec);
  const handle = Math.max(0, Number.isFinite(handleSec) ? handleSec : 0);
  const trimStartSec = Math.max(0, cutIn - handle);
  const wantedEnd = cutOut + handle;
  const trimEndSec = fileDurationSec > 0 ? Math.min(wantedEnd, fileDurationSec) : wantedEnd;
  return {
    trimStartSec,
    trimEndSec,
    inSec: cutIn - trimStartSec,
    outSec: cutOut - trimStartSec,
    fileDurationSec: Math.max(0, trimEndSec - trimStartSec),
  };
}
