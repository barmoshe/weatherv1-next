// Browser build: the 9:16 render on WebCodecs (Mediabunny), mirroring the
// ffmpeg graph in src/server/ffmpeg/renderer.ts:
//   - per pick: decode `decodeDur` from `seekStart`, scale+crop to 1080×1920
//     (CanvasSink fit "cover" = scale increase + center crop), hold the last
//     frame for `padDur`; picks are joined with hard cuts
//   - hold the last frame to the narration's end if the picks run short
//   - narration + music looped at -16 dB, summed without normalisation
//   - H.264 + AAC, cut to the narration length
// The MP4 streams straight into the library's outputs/ folder.

import fs from "node:fs";
import {
  ALL_FORMATS,
  AudioBufferSource,
  BlobSource,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  canEncodeAudio,
} from "mediabunny";
import { registerAacEncoder } from "@mediabunny/aac-encoder";
import type { ResolvedPick, ParsedVideo } from "@/shared/types";
import { getAssetSource } from "@/server/assets/source";
import { narrativeDecodeFromPick } from "@/server/ffmpeg/timeline-clip-timing";
import { registerProcess, unregisterProcess } from "./spawn";
import { readExternal, registerExternal, toFolderPath } from "../../../runtime/vfs";
import * as folder from "../../../runtime/folder";

const FPS = 30;
const W = 1080;
const H = 1920;
const SAMPLE_RATE = 48_000;
const DEFAULT_MUSIC_DB = -16;

export interface RenderOptions {
  jobId?: string;
  bgMusicPath?: string;
  bgMusicVolume?: string;
  onProgress?: (pct: number) => void;
}

interface Slice {
  filePath: string;
  seekStart: number;
  decodeDur: number;
  audioDur: number;
}

let aacReady: Promise<void> | null = null;
function ensureAac(): Promise<void> {
  aacReady ??= canEncodeAudio("aac").then((ok) => {
    if (!ok) registerAacEncoder();
  });
  return aacReady;
}

function dbToGain(vol: string | undefined): number {
  const db = vol ? Number.parseFloat(vol) : DEFAULT_MUSIC_DB;
  return 10 ** ((Number.isFinite(db) ? db : DEFAULT_MUSIC_DB) / 20);
}

async function decodeAudio(vpath: string): Promise<AudioBuffer> {
  const bytes = await (await readExternal(vpath)).arrayBuffer();
  return new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes);
}

/** Narration + looped music, summed (amix normalize=0), narration length. */
async function mixAudio(narration: AudioBuffer, musicPath: string | null, musicGain: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, narration.length, SAMPLE_RATE);
  const voice = ctx.createBufferSource();
  voice.buffer = narration;
  voice.connect(ctx.destination);
  voice.start(0);
  if (musicPath) {
    const music = ctx.createBufferSource();
    music.buffer = await decodeAudio(musicPath);
    music.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = musicGain;
    music.connect(gain).connect(ctx.destination);
    music.start(0);
  }
  return ctx.startRendering();
}

export async function renderVideo(
  timeline: ResolvedPick[],
  videoMap: Record<string, ParsedVideo>,
  audioPath: string,
  outputPath: string,
  opts: RenderOptions = {},
): Promise<boolean> {
  const slices: Slice[] = [];
  for (const pick of timeline) {
    const vid = videoMap[pick.video_id];
    if (!vid) {
      console.warn(`Warning: Video ${pick.video_id} not found in map. Skipping.`);
      continue;
    }
    const { audioDur, seekStart, decodeDur } = narrativeDecodeFromPick(pick);
    if (audioDur <= 0 || decodeDur <= 0) continue;
    slices.push({ filePath: vid.path, seekStart, decodeDur, audioDur });
  }
  if (!slices.length) return false;

  const rel = toFolderPath(outputPath);
  if (!rel) throw new Error(`render output outside the library: ${outputPath}`);

  let aborted = false;
  if (opts.jobId) registerProcess(opts.jobId, () => (aborted = true));

  await ensureAac();
  const narration = await decodeAudio(audioPath);
  const musicPath = opts.bgMusicPath ?? getAssetSource().getDefaultBgMusicPath();
  const mixed = await mixAudio(narration, fs.existsSync(musicPath) ? musicPath : null, dbToGain(opts.bgMusicVolume));
  const totalFrames = Math.round(narration.duration * FPS);

  const canvas = new OffscreenCanvas(W, H);
  const ctx2d = canvas.getContext("2d")!;
  ctx2d.fillStyle = "#000";
  ctx2d.fillRect(0, 0, W, H);

  const writable = await folder.openWritable(rel);
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: false }),
    target: new StreamTarget(writable as unknown as WritableStream, { chunked: true }),
  });
  const video = new CanvasSource(canvas, { codec: "avc", bitrate: QUALITY_HIGH, keyFrameInterval: 2 });
  const audio = new AudioBufferSource({ codec: "aac", bitrate: 160_000 });
  output.addVideoTrack(video, { frameRate: FPS });
  output.addAudioTrack(audio);

  try {
    await output.start();
    await audio.add(mixed);

    let frame = 0;
    let cum = 0;
    const emit = async () => {
      await video.add(frame / FPS, 1 / FPS);
      frame += 1;
      if (frame % FPS === 0) opts.onProgress?.(Math.min(0.99, frame / totalFrames));
    };

    for (const s of slices) {
      if (aborted || frame >= totalFrames) break;
      const endFrame = Math.min(totalFrames, Math.round((cum + s.audioDur) * FPS));
      cum += s.audioDur;
      const sliceFrames = endFrame - frame;
      if (sliceFrames <= 0) continue;
      const decodeFrames = Math.min(sliceFrames, Math.max(1, Math.round(s.decodeDur * FPS)));

      const input = new Input({ source: new BlobSource(await readExternal(s.filePath)), formats: ALL_FORMATS });
      try {
        const track = await input.getPrimaryVideoTrack();
        if (track) {
          const first = await track.getFirstTimestamp();
          const sink = new CanvasSink(track, { width: W, height: H, fit: "cover", poolSize: 2 });
          const times = Array.from({ length: decodeFrames }, (_, i) => first + s.seekStart + i / FPS);
          for await (const wrapped of sink.canvasesAtTimestamps(times)) {
            if (aborted) break;
            if (wrapped) ctx2d.drawImage(wrapped.canvas as CanvasImageSource, 0, 0, W, H);
            await emit();
          }
        }
      } finally {
        input.dispose();
      }
      // Freeze the last frame for the rest of the slice (tpad stop_mode=clone).
      while (!aborted && frame < endFrame) await emit();
    }
    // Picks shorter than the narration: hold the last frame to the end.
    while (!aborted && frame < totalFrames) await emit();

    if (aborted) {
      await output.cancel();
      await folder.removeFile(rel);
      return false;
    }
    await output.finalize();
    const size = await folder.fileSize(rel);
    registerExternal(outputPath, size);
    opts.onProgress?.(1);
    return true;
  } catch (err) {
    console.error("[render] failed:", err);
    await output.cancel().catch(() => undefined);
    return false;
  } finally {
    if (opts.jobId) unregisterProcess(opts.jobId);
  }
}
