// Browser build: ffprobe's answers from Mediabunny (web/media/video.ts).
import { probePath } from "../../../media/video";

export interface ProbeResult {
  durationSec: number;
  width: number;
  height: number;
  orientation: "H" | "V";
  videoCodec: string;
  pixFmt: string;
  hasAudio: boolean;
  audioCodec?: string;
}

export async function probeVideo(absPath: string): Promise<ProbeResult> {
  try {
    const i = await probePath(absPath);
    return {
      durationSec: i.durationSec,
      width: i.width,
      height: i.height,
      orientation: i.width > i.height ? "H" : "V",
      videoCodec: i.videoCodec,
      pixFmt: "",
      hasAudio: i.hasAudio,
      audioCodec: i.audioCodec,
    };
  } catch (err) {
    console.warn(`probeVideo failed for ${absPath}:`, err);
    return { durationSec: 0, width: 0, height: 0, orientation: "V", videoCodec: "", pixFmt: "", hasAudio: false };
  }
}

export async function probeDimensionsAndDuration(absPath: string): Promise<{ durationSec: number; orientation: "H" | "V" }> {
  const r = await probeVideo(absPath);
  return { durationSec: r.durationSec, orientation: r.orientation };
}
