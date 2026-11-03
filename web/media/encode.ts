// A standalone 9:16 clip for the Premiere bundle: `durSec` of footage from
// `startSec`, cover-cropped to 1080×1920 (the renderer's frame), H.264, no
// audio — the browser twin of media-bundle's ffmpeg trim.

import { ALL_FORMATS, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input, Mp4OutputFormat, Output, QUALITY_HIGH } from "mediabunny";

const FPS = 30;
const W = 1080;
const H = 1920;

export async function encodeVerticalClip(source: Blob, startSec: number, durSec: number): Promise<Uint8Array> {
  const input = new Input({ source: new BlobSource(source), formats: ALL_FORMATS });
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext("2d")!;
  const target = new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: "in-memory" }), target });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH });
  output.addVideoTrack(video, { frameRate: FPS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error("no video track");
    await output.start();
    const first = await track.getFirstTimestamp();
    const sink = new CanvasSink(track, { width: W, height: H, fit: "cover", poolSize: 2 });
    const frames = Math.max(1, Math.round(durSec * FPS));
    const times = Array.from({ length: frames }, (_, i) => first + startSec + i / FPS);
    let i = 0;
    for await (const wrapped of sink.canvasesAtTimestamps(times)) {
      if (wrapped) ctx.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, W, H);
      await video.add(i / FPS, 1 / FPS);
      i += 1;
    }
    await output.finalize();
    return new Uint8Array(target.buffer!);
  } finally {
    input.dispose();
  }
}
