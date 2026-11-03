// Local whisper.cpp transcription provider (the only transcription path since
// v0.7.0; OpenAI cloud Whisper is gone).
//
// Pipeline:
//   1. ffmpeg converts the input audio (any container) to 16 kHz mono PCM WAV,
//      the format whisper.cpp reads, using the app's bundled ffmpeg
//      (`FFMPEG_PATH`).
//   2. Spawn the pinned `whisper-cli` with the ivrit-ai Hebrew model and the
//      Silero VAD model; `-oj` writes a `<prefix>.json` sidecar.
//   3. Parse the sidecar into `WhisperSegment[]` and run `fixTranscript`, the
//      same Hebrew post-processing the cloud path used.
//
// The work dir is ASCII-safe on Windows (see `whisperSafeDir`), because
// whisper.cpp opens files with narrow paths.

import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { resolveWhisperBinary } from "@/server/whisper/binary";
import { WHISPER_MODEL_ID, getInstalledModel, whisperSafeDir } from "@/server/whisper/models";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { WHISPER_HE_PROMPT, fixTranscript } from "@/server/pipeline/transcript-fixes";
import type { WhisperSegment } from "@/shared/types";
import {
  type TranscriptionProvider,
  type TranscriptionResult,
  TranscriptionProviderError,
} from "./types";

export function createLocalWhisperProvider(): TranscriptionProvider {
  return {
    id: "local-whisper",
    transcribe: transcribeLocally,
  };
}

async function transcribeLocally(audioPath: string): Promise<TranscriptionResult> {
  const binary = resolveWhisperBinary();
  if (!binary) {
    throw new TranscriptionProviderError(
      "whisper-cli binary not found in the app's resources.",
      "transcription_binary_missing",
      "local-whisper",
    );
  }
  const model = getInstalledModel();
  if (!model) {
    throw new TranscriptionProviderError(
      "The Hebrew transcription model is not downloaded yet.",
      "transcription_no_model",
      "local-whisper",
    );
  }
  const ffmpegPath = getRuntimeConfig().ffmpegPath ?? "ffmpeg";

  const baseTmp = whisperSafeDir(getRuntimePaths().tmpDir, "tmp");
  await fsp.mkdir(baseTmp, { recursive: true });
  const workDir = await fsp.mkdtemp(path.join(baseTmp, "whisper-"));
  const wavPath = path.join(workDir, "audio-16k.wav");
  const outputPrefix = path.join(workDir, "transcript");

  try {
    await run(ffmpegPath, ["-y", "-i", audioPath, "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", wavPath], "ffmpeg");
    await run(binary.path, whisperArgs(model.modelPath, model.vadPath, wavPath, outputPrefix), "whisper-cli");
    const raw = await fsp.readFile(`${outputPrefix}.json`, "utf8");
    return parseWhisperCppJson(raw);
  } finally {
    fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

export function whisperArgs(
  modelPath: string,
  vadPath: string,
  wavPath: string,
  outputPrefix: string,
): string[] {
  // Flag rationale:
  // -l he: the ivrit-ai card asks for the language token explicitly (its
  //   language detection regressed in fine-tuning).
  // --prompt + --carry-initial-prompt: the Hebrew weather vocabulary, kept
  //   for every 30 s window, not only the first.
  // -ml 60 -sow: ~one Hebrew sentence per segment, split on word boundaries.
  //   The planner snaps scene boundaries to segment ends, so one giant
  //   segment per decode window would collapse scene planning.
  // -sns --vad -vm: suppress non-speech tokens and skip music/silence, the
  //   known hallucination source.
  // -oj -of: JSON sidecar at <prefix>.json. -np: no stdout chatter.
  const threads = Math.max(1, Math.min(8, (os.availableParallelism?.() ?? os.cpus().length) - 1));
  return [
    "-m", modelPath,
    "-f", wavPath,
    "-l", "he",
    "--prompt", WHISPER_HE_PROMPT,
    "--carry-initial-prompt",
    "-ml", "60",
    "-sow",
    "-sns",
    "--vad",
    "-vm", vadPath,
    "-t", String(threads),
    "-oj",
    "-of", outputPrefix,
    "-np",
  ];
}

function run(bin: string, args: string[], label: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-16_000);
    });
    child.on("error", (err) =>
      reject(new TranscriptionProviderError(`${label} could not start: ${err.message}`, "transcription_failed", "local-whisper", err)),
    );
    child.on("close", (code) => {
      if (code === 0) return resolve();
      reject(
        new TranscriptionProviderError(
          `${label} failed (exit ${code}): ${stderr.slice(-2048)}`,
          "transcription_failed",
          "local-whisper",
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
}

export function parseWhisperCppJson(raw: string): TranscriptionResult {
  let parsed: WhisperCppJson;
  try {
    parsed = JSON.parse(raw) as WhisperCppJson;
  } catch (err) {
    throw new TranscriptionProviderError(
      `Failed to parse whisper-cli JSON output: ${err instanceof Error ? err.message : String(err)}`,
      "transcription_failed",
      "local-whisper",
    );
  }

  const segments: WhisperSegment[] = (parsed.transcription ?? [])
    .map((item) => ({
      start: (item.offsets?.from ?? parseTimestamp(item.timestamps?.from) * 1000) / 1000,
      end: (item.offsets?.to ?? parseTimestamp(item.timestamps?.to) * 1000) / 1000,
      text: fixTranscript((item.text ?? "").trim()),
    }))
    .filter((s) => s.text.length > 0)
    .map((s, i) => ({ idx: i, start: round3(s.start), end: round3(s.end), text: s.text }));

  const text = fixTranscript(segments.map((s) => s.text).join(" "));
  const duration = segments.length ? segments[segments.length - 1].end : 0;
  return {
    text,
    segments,
    duration,
    transcription_model: WHISPER_MODEL_ID,
    // Local transcription is free; nothing is metered.
    billed_audio_sec: 0,
  };
}

/** whisper.cpp's `HH:MM:SS,mmm` (or `.mmm`) in seconds; 0 on bad input. */
function parseTimestamp(value: string | undefined): number {
  const m = /^(\d+):(\d+):(\d+)[.,](\d+)$/.exec(value?.trim() ?? "");
  if (!m) return 0;
  return +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
