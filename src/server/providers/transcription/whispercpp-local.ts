// Local whisper.cpp transcription provider.
//
// Pipeline:
//   1. ffmpeg converts the input audio (any container) to 16 kHz mono PCM
//      WAV — the format whisper.cpp expects. We reuse the bundled ffmpeg
//      that's already resolved in `electron/ffmpeg-verify.cjs` and exposed
//      to the child server via `FFMPEG_PATH`.
//   2. Spawn `whisper-cli -m <ggml-model.bin> -l he -f <16k.wav> -oj
//      --no-prints --output-file <prefix> [--prompt <hebrew-prompt>]`.
//      `-oj` writes a `<prefix>.json` sidecar that contains transcription
//      segments with timestamps.
//   3. Parse the JSON sidecar, apply `fixTranscript` for the same Hebrew
//      post-processing the cloud path used, return the canonical
//      TranscriptionResult shape.

import fsp from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { resolveWhisperBinary } from "@/server/whisper/binary";
import { pickActiveModel } from "@/server/whisper/models";
import { getRuntimeConfig } from "@/server/runtime/config";
import { WHISPER_HE_PROMPT, fixTranscript } from "@/server/pipeline/transcript-fixes";
import type { WhisperSegment } from "@/shared/types";
import {
  type TranscriptionProvider,
  type TranscriptionResult,
  TranscriptionProviderError,
} from "./types";

export function createLocalWhisperProvider(): TranscriptionProvider {
  return {
    id: "local-whispercpp",
    transcribe(audioPath: string): Promise<TranscriptionResult> {
      return transcribeLocally(audioPath);
    },
  };
}

async function transcribeLocally(audioPath: string): Promise<TranscriptionResult> {
  const binary = resolveWhisperBinary();
  if (!binary) {
    throw new TranscriptionProviderError(
      "whisper-cli binary not found. Install whisper.cpp or ship a bundled binary.",
      "transcription_binary_missing",
      "local-whispercpp",
    );
  }

  const model = pickActiveModel();
  if (!model) {
    throw new TranscriptionProviderError(
      "No Whisper model installed. Open Settings and download one.",
      "transcription_no_model",
      "local-whispercpp",
    );
  }

  const ffmpegPath = getRuntimeConfig().ffmpegPath;
  if (!ffmpegPath) {
    throw new TranscriptionProviderError(
      "FFMPEG_PATH is not set; local Whisper needs ffmpeg to convert audio to 16 kHz WAV.",
      "transcription_failed",
      "local-whispercpp",
    );
  }

  const workDir = await fsp.mkdtemp(path.join(os.tmpdir(), "weatherv1-whisper-"));
  const wavPath = path.join(workDir, "audio-16k.wav");
  const outputPrefix = path.join(workDir, "transcript");
  const sidecarPath = `${outputPrefix}.json`;

  try {
    await runFfmpegTo16kWav(ffmpegPath, audioPath, wavPath);
    await runWhisperCli(binary.path, model.path, wavPath, outputPrefix);
    const raw = await fsp.readFile(sidecarPath, "utf8");
    return parseWhisperCppJson(raw);
  } finally {
    // Best-effort cleanup; never throw from here.
    fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
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
      "16000",
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
          "local-whispercpp",
        ),
      );
    });
  });
}

function runWhisperCli(
  binaryPath: string,
  modelPath: string,
  wavPath: string,
  outputPrefix: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Flag rationale:
    // -m / -f / -l / -oj / -of / --prompt: standard transcription wiring.
    // -ml 60: max segment length in characters. Without this, whisper.cpp
    //   returns one giant segment per ~30s decode chunk, which collapses
    //   downstream scene planning (the planner snaps scene boundaries to
    //   Whisper segment ends — one segment = one scene). 60 chars ≈ one
    //   Hebrew sentence and roughly matches what whisper-1 cloud emits.
    // -sow: split on word boundaries instead of mid-word when -ml triggers.
    // --no-prints: suppress whisper.cpp's stdout chatter; the JSON sidecar
    //   is the authoritative output.
    const args = [
      "-m",
      modelPath,
      "-f",
      wavPath,
      "-l",
      "he",
      "-oj",
      "-of",
      outputPrefix,
      "--prompt",
      WHISPER_HE_PROMPT,
      "-ml",
      "60",
      "-sow",
      "--no-prints",
    ];
    const child = spawn(binaryPath, args, { stdio: ["ignore", "pipe", "pipe"] });
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
          `whisper-cli failed (exit ${code}): ${tail(stderr, 2048)}`,
          "transcription_failed",
          "local-whispercpp",
        ),
      );
    });
  });
}

interface WhisperCppJson {
  transcription?: Array<{
    timestamps?: { from?: string; to?: string };
    offsets?: { from?: number; to?: number }; // milliseconds
    text?: string;
  }>;
  result?: { language?: string };
}

function parseWhisperCppJson(raw: string): TranscriptionResult {
  let parsed: WhisperCppJson;
  try {
    parsed = JSON.parse(raw) as WhisperCppJson;
  } catch (err) {
    throw new TranscriptionProviderError(
      `Failed to parse whisper-cli JSON output: ${err instanceof Error ? err.message : String(err)}`,
      "transcription_failed",
      "local-whispercpp",
    );
  }

  const items = parsed.transcription ?? [];
  const segments: WhisperSegment[] = items.map((item, i) => {
    const startMs = item.offsets?.from ?? parseTimestamp(item.timestamps?.from) * 1000;
    const endMs = item.offsets?.to ?? parseTimestamp(item.timestamps?.to) * 1000;
    return {
      idx: i,
      start: Number((startMs / 1000).toFixed(3)),
      end: Number((endMs / 1000).toFixed(3)),
      text: fixTranscript((item.text ?? "").trim()),
    };
  });

  const text = fixTranscript(segments.map((s) => s.text).join(" ").trim());
  const duration = segments.length ? segments[segments.length - 1].end : 0;

  return { text, segments, duration };
}

/** Parse whisper.cpp's `HH:MM:SS.mmm` into seconds; returns 0 on bad input. */
function parseTimestamp(value: string | undefined): number {
  if (!value) return 0;
  const m = /^(\d+):(\d+):(\d+)\.(\d+)$/.exec(value.trim());
  if (!m) return 0;
  const h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  const s = parseInt(m[3], 10);
  const ms = parseInt(m[4], 10);
  return h * 3600 + min * 60 + s + ms / 1000;
}

function tail(s: string, n: number): string {
  return s.length <= n ? s : s.slice(-n);
}

// Exported for tests
export const __internal = { parseWhisperCppJson, parseTimestamp };
