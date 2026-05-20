import { describe, it, expect } from "vitest";
import { clipSourceWindow, clipTrimWindow } from "@/server/ffmpeg/timeline-clip-timing";
import type { ResolvedPick } from "@/shared/types";

function pick(over: Partial<ResolvedPick>): ResolvedPick {
  return {
    scene_idx: 0,
    segment_id: "X-s0",
    video_id: "X",
    audio_start: 0,
    audio_end: 0,
    video_start: 0,
    video_end: 0,
    reason: "",
    ...over,
  } as ResolvedPick;
}

describe("clipSourceWindow", () => {
  it("derives [0, audioDur] when the pick has no explicit video range (real jobs)", () => {
    const p = pick({ audio_start: 0, audio_end: 6.76, video_start: undefined, video_end: undefined });
    expect(clipSourceWindow(p, 30)).toEqual({ inSec: 0, outSec: 6.76 });
  });

  it("honors an explicit video_start as the seek point", () => {
    const p = pick({ audio_start: 0, audio_end: 5, video_start: 3, video_end: undefined });
    expect(clipSourceWindow(p, 30)).toEqual({ inSec: 3, outSec: 8 });
  });

  it("clamps out to the file duration for clips shorter than the narration", () => {
    const p = pick({ audio_start: 0, audio_end: 10, video_start: undefined, video_end: undefined });
    expect(clipSourceWindow(p, 4)).toEqual({ inSec: 0, outSec: 4 });
  });

  it("does not clamp when the file duration is unknown (0)", () => {
    const p = pick({ audio_start: 2, audio_end: 8, video_start: undefined, video_end: undefined });
    expect(clipSourceWindow(p, 0)).toEqual({ inSec: 0, outSec: 6 });
  });
});

describe("clipTrimWindow", () => {
  it("pads a mid-file cut by a full handle on each side and rebases in/out", () => {
    // cut [5,10] in a 30s file → trim [4,11]; planned cut sits 1s into the trim.
    const p = pick({ audio_start: 0, audio_end: 5, video_start: 5, video_end: undefined });
    expect(clipTrimWindow(p, 30, 1)).toEqual({
      trimStartSec: 4,
      trimEndSec: 11,
      inSec: 1,
      outSec: 6,
      fileDurationSec: 7,
    });
  });

  it("clamps the leading handle when the cut starts at the file head", () => {
    // cut [0,5] → trim [0,6]; no room for a head handle, so in stays at 0.
    const p = pick({ audio_start: 0, audio_end: 5, video_start: 0, video_end: undefined });
    expect(clipTrimWindow(p, 30, 1)).toEqual({
      trimStartSec: 0,
      trimEndSec: 6,
      inSec: 0,
      outSec: 5,
      fileDurationSec: 6,
    });
  });

  it("clamps the trailing handle to the file end", () => {
    // cut [0,10] clamped to a 10s file → trim [0,10]; trailing handle has no room.
    const p = pick({ audio_start: 0, audio_end: 10, video_start: undefined, video_end: undefined });
    expect(clipTrimWindow(p, 10, 1)).toEqual({
      trimStartSec: 0,
      trimEndSec: 10,
      inSec: 0,
      outSec: 10,
      fileDurationSec: 10,
    });
  });

  it("never lets the rebased out exceed the trimmed file duration", () => {
    const p = pick({ audio_start: 0, audio_end: 4, video_start: 2, video_end: undefined });
    const w = clipTrimWindow(p, 30, 1);
    expect(w.outSec).toBeLessThanOrEqual(w.fileDurationSec);
    expect(w.inSec).toBeGreaterThanOrEqual(0);
  });
});
