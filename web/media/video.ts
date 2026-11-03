// Video reading in the browser (Mediabunny over WebCodecs): metadata for the
// catalog (ffprobe's job) and single frames for posters (ffmpeg's job).

import { ALL_FORMATS, BlobSource, CanvasSink, Input } from "mediabunny";
import { readExternal } from "../runtime/vfs";

export interface VideoInfo {
  durationSec: number;
  width: number;
  height: number;
  videoCodec: string;
  hasAudio: boolean;
  audioCodec?: string;
}

export function openInput(blob: Blob): Input {
  return new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
}

export async function probeBlob(blob: Blob): Promise<VideoInfo> {
  const input = openInput(blob);
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    return {
      durationSec: await input.computeDuration(),
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      videoCodec: video?.codec ?? "",
      hasAudio: Boolean(audio),
      audioCodec: audio?.codec ?? undefined,
    };
  } finally {
    input.dispose();
  }
}

/** One frame at `seekSec` as a JPEG, `width` px wide (height keeps aspect). */
export async function frameJpeg(blob: Blob, seekSec: number, width: number): Promise<Blob | null> {
  const input = openInput(blob);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return null;
    const sink = new CanvasSink(track, { width, poolSize: 1 });
    const start = await track.getFirstTimestamp();
    const frame = (await sink.getCanvas(start + Math.max(0, seekSec))) ?? (await sink.getCanvas(start));
    if (!frame) return null;
    const canvas = frame.canvas as OffscreenCanvas | HTMLCanvasElement;
    if ("convertToBlob" in canvas) return canvas.convertToBlob({ type: "image/jpeg", quality: 0.8 });
    return new Promise((resolve) => (canvas as HTMLCanvasElement).toBlob(resolve, "image/jpeg", 0.8));
  } finally {
    input.dispose();
  }
}

export async function probePath(vpath: string): Promise<VideoInfo> {
  return probeBlob(await readExternal(vpath));
}
