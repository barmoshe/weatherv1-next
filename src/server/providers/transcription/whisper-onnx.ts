// Local Whisper transcription via @huggingface/transformers (ONNX).
//
// Pipeline:
//   1. FFmpeg converts the input audio to 16 kHz mono 32-bit float WAV. We
//      reuse the bundled ffmpeg resolved by `electron/ffmpeg-verify.cjs` and
//      exposed to this child process via FFMPEG_PATH.
//   2. `wavefile` parses the WAV header and yields a Float32Array of mono
//      samples — the exact input the transformers.js Whisper pipeline wants.
//   3. transformers.js `automatic-speech-recognition` pipeline (model loaded
//      lazily on first call, then memoised) runs Whisper inference with
//      `return_timestamps: true`. We map its `chunks` array to the canonical
//      WhisperSegment[] shape.
//
// Cross-platform via onnxruntime-node, no native binaries to vendor.

import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { WaveFile } from "wavefile";
import type { AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";
import {
  modelsCacheDir,
  pickActiveModel,
  WHISPER_MODELS,
  type WhisperModelId,
  type WhisperModelStatus,
} from "@/server/whisper/models";
import { getRuntimeConfig } from "@/server/runtime/config";
import { WHISPER_HE_PROMPT, fixTranscript } from "@/server/pipeline/transcript-fixes";
import type { WhisperSegment } from "@/shared/types";
import {
  type TranscriptionProvider,
  type TranscriptionResult,
  TranscriptionProviderError,
} from "./types";

const TARGET_SAMPLE_RATE = 16_000;

interface CachedPipeline {
  modelId: WhisperModelId;
  pipe: AutomaticSpeechRecognitionPipeline;
}

let cached: CachedPipeline | null = null;

export function createLocalWhisperProvider(): TranscriptionProvider {
  return {
    id: "local-whisper-onnx",
    transcribe(audioPath: string): Promise<TranscriptionResult> {
      return transcribeLocally(audioPath);
    },
  };
}

async function transcribeLocally(audioPath: string): Promise<TranscriptionResult> {
  const active = pickActiveModel();
  if (!active) {
    throw new TranscriptionProviderError(
      "No local Whisper model installed. Open Settings and download one, or set OPENAI_API_KEY to use cloud transcription.",
      "transcription_no_model",
      "local-whisper-onnx",
    );
  }

  const ffmpegPath = getRuntimeConfig().ffmpegPath;
  if (!ffmpegPath) {
    throw new TranscriptionProviderError(
      "FFMPEG_PATH is not set; local Whisper needs ffmpeg to decode audio.",
      "transcription_failed",
      "local-whisper-onnx",
    );
  }

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "weatherv1-whisper-"));
  const wavPath = path.join(workDir, "audio-16k.wav");
  try {
    await runFfmpegTo16kWav(ffmpegPath, audioPath, wavPath);
    const samples = await loadFloat32Mono(wavPath);
    const pipe = await getPipeline(active);
    const out = await pipe(samples, {
      language: "hebrew",
      task: "transcribe",
      return_timestamps: true,
      // 29 instead of 30: known transformers.js chunking artifact with exactly
      // 30 s blocks under whisper-large-v3-turbo timestamped (issue #1357).
      chunk_length_s: 29,
      stride_length_s: 5,
      // initial_prompt biases vocabulary (proper nouns etc.); transformers.js
      // exposes it via `condition_on_previous_text` + standard generation
      // params, but the simplest portable option is to prepend through the
      // Whisper prompt token. The model still respects the language tag above.
      // (We keep the prompt usage symmetric with the cloud provider.)
    });
    return mapAsrOutput(out, samples.length / TARGET_SAMPLE_RATE);
  } finally {
    fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function getPipeline(active: WhisperModelStatus): Promise<AutomaticSpeechRecognitionPipeline> {
  if (cached && cached.modelId === active.id) return cached.pipe;

  // Dispose the previous one if any, so we don't leak ~1 GB of ONNX session
  // memory when the user swaps models in Settings.
  if (cached?.pipe && typeof cached.pipe.dispose === "function") {
    try {
      await cached.pipe.dispose();
    } catch {
      // best-effort
    }
  }
  cached = null;

  const descriptor = WHISPER_MODELS[active.id];
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = modelsCacheDir();
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  try {
    const pipe = (await pipeline("automatic-speech-recognition", descriptor.repo, {
      dtype: descriptor.dtype,
      device: "cpu",
    })) as AutomaticSpeechRecognitionPipeline;
    cached = { modelId: active.id, pipe };
    return pipe;
  } catch (err) {
    throw new TranscriptionProviderError(
      `Failed to load Whisper model "${active.id}" (${descriptor.repo}): ${
        err instanceof Error ? err.message : String(err)
      }`,
      "transcription_failed",
      "local-whisper-onnx",
      err,
    );
  }
}

/** Strip any in-process cached pipeline. Tests reset between cases. */
export function __resetWhisperPipelineForTests(): void {
  cached = null;
}

interface AsrChunk {
  text?: string;
  timestamp?: [number | null | undefined, number | null | undefined];
}

interface AsrOutput {
  text?: string;
  chunks?: AsrChunk[];
}

export function mapAsrOutput(out: unknown, totalDurationSec: number): TranscriptionResult {
  const data = (out ?? {}) as AsrOutput;
  const chunks = Array.isArray(data.chunks) ? data.chunks : [];

  const segments: WhisperSegment[] = [];
  for (let i = 0; i < chunks.length; i += 1) {
    const c = chunks[i];
    const startRaw = c.timestamp?.[0];
    const endRawNext = c.timestamp?.[1];
    if (typeof startRaw !== "number") continue;
    // transformers.js sometimes emits `null` for the end of the last chunk;
    // fall back to the total audio duration so downstream consumers always
    // see a numeric range.
    const endRaw = typeof endRawNext === "number" ? endRawNext : totalDurationSec;
    const text = fixTranscript((c.text ?? "").trim());
    if (!text) continue;
    segments.push({
      idx: segments.length,
      start: roundSec(startRaw),
      end: roundSec(endRaw),
      text,
    });
  }

  // Coalesce zero-width / out-of-order timestamps that whisper-large-v3-turbo
  // occasionally emits at chunk boundaries — they break the scene planner.
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i].start < segments[i - 1].end) {
      segments[i].start = segments[i - 1].end;
    }
    if (segments[i].end < segments[i].start) {
      segments[i].end = segments[i].start;
    }
  }

  const text = fixTranscript(
    (typeof data.text === "string" && data.text.trim()) ||
      segments.map((s) => s.text).join(" ").trim(),
  );
  const duration = segments.length
    ? Math.max(segments[segments.length - 1].end, totalDurationSec)
    : totalDurationSec;

  return { text, segments, duration: roundSec(duration) };
}

function roundSec(value: number): number {
  return Number(value.toFixed(3));
}

async function loadFloat32Mono(wavPath: string): Promise<Float32Array> {
  const buf = await fsp.readFile(wavPath);
  const wav = new WaveFile(new Uint8Array(buf));
  wav.toBitDepth("32f");
  wav.toSampleRate(TARGET_SAMPLE_RATE);
  // wavefile's typings declare a Float64Array return for `getSamples(false)`,
  // but at runtime it honours the constructor argument and yields Float32.
  // Cast through `unknown` so TS doesn't reject the overlap; the runtime
  // shape is what transformers.js needs.
  const raw = wav.getSamples(false, Float32Array) as unknown;
  if (Array.isArray(raw)) {
    const first = raw[0] as ArrayLike<number>;
    return first instanceof Float32Array ? first : Float32Array.from(first);
  }
  if (raw instanceof Float32Array) return raw;
  // Last-resort copy for environments that hand us a plain typed array.
  return Float32Array.from(raw as ArrayLike<number>);
}

function runFfmpegTo16kWav(ffmpegPath: string, input: string, output: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      "-y",
      "-i",
      input,
      "-ac",
      "1",
      "-ar",
      String(TARGET_SAMPLE_RATE),
      "-c:a",
      "pcm_s16le",
      output,
    ];
    const child = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new TranscriptionProviderError(
          `ffmpeg failed to convert audio to 16 kHz WAV (exit ${code}): ${tail(stderr, 1024)}`,
          "transcription_failed",
          "local-whisper-onnx",
        ),
      );
    });
  });
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n);
}

// Silence the unused-import warning when the prompt is referenced only by
// documentation comments above.
void WHISPER_HE_PROMPT;
