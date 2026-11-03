// The local transcription model: one fixed Hebrew Whisper model plus the
// Silero VAD model, downloaded once on first use and sha256-verified.
//
//   - ivrit-ai/whisper-large-v3-turbo-ggml (Apache-2.0): Whisper large-v3
//     turbo fine-tuned on Hebrew, converted for whisper.cpp. 1.62 GB.
//   - ggml-org/whisper-vad ggml-silero-v6.2.0 (885 kB): voice-activity
//     detection, so music beds and silence don't hallucinate text.
//
// URLs are pinned to Hugging Face commits, not `main`, so the sha256 can never
// drift under us. Files land in `<runtime>/cache/whisper-models/` (userData in
// the packaged app), which survives reinstalls. Downloads stream to `.part`,
// are hashed on the way, and only a verified file is renamed into place.
//
// Download state lives in this module (one download at a time per process);
// the Settings UI polls `/api/whisper` for progress.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getRuntimePaths } from "@/server/runtime/paths";

export interface WhisperModelFile {
  id: "model" | "vad";
  filename: string;
  url: string;
  sha256: string;
  sizeBytes: number;
}

export const WHISPER_MODEL_ID = "ivrit-ai/whisper-large-v3-turbo";

export const WHISPER_FILES: readonly WhisperModelFile[] = [
  {
    id: "model",
    filename: "ivrit-whisper-large-v3-turbo.bin",
    url: "https://huggingface.co/ivrit-ai/whisper-large-v3-turbo-ggml/resolve/2130c78e4a9cb4914cc4df91a1c3031407789705/ggml-model.bin",
    sha256: "c8090411113357097bfafc2b8e228ec1639fa7f5fe4ecb5d054ac0ccef8641b1",
    sizeBytes: 1_624_555_275,
  },
  {
    id: "vad",
    filename: "ggml-silero-v6.2.0.bin",
    url: "https://huggingface.co/ggml-org/whisper-vad/resolve/9ffd54a1e1ee413ddf265af9913beaf518d1639b/ggml-silero-v6.2.0.bin",
    sha256: "2aa269b785eeb53a82983a20501ddf7c1d9c48e33ab63a41391ac6c9f7fb6987",
    sizeBytes: 885_098,
  },
];

const TOTAL_BYTES = WHISPER_FILES.reduce((sum, f) => sum + f.sizeBytes, 0);

/**
 * True when every char is printable ASCII. whisper.cpp is reported to fail on
 * non-ASCII paths on Windows (it opens files with narrow fopen), and a Hebrew
 * Windows username puts Hebrew into every userData/temp path.
 */
export function isAsciiPath(p: string): boolean {
  return /^[\x20-\x7e]*$/.test(p);
}

/**
 * A directory whisper.cpp can open on this machine. Prefers `preferred`; on
 * Windows, when that path holds non-ASCII characters, falls back to
 * `%ProgramData%\WeatherV1\<sub>` (C:\ProgramData is ASCII and user-writable).
 */
export function whisperSafeDir(preferred: string, sub: string): string {
  if (process.platform !== "win32" || isAsciiPath(preferred)) return preferred;
  const programData = process.env.ProgramData || "C:\\ProgramData";
  return path.join(programData, "WeatherV1", sub);
}

export function modelsDir(): string {
  const override = process.env.WHISPER_MODEL_DIR?.trim();
  if (override) return override;
  return whisperSafeDir(path.join(getRuntimePaths().cacheDir, "whisper-models"), "whisper-models");
}

function filePath(f: WhisperModelFile): string {
  return path.join(modelsDir(), f.filename);
}

function markerPath(f: WhisperModelFile): string {
  return `${filePath(f)}.verified`;
}

function isInstalled(f: WhisperModelFile): boolean {
  return fs.existsSync(filePath(f)) && fs.existsSync(markerPath(f));
}

export interface InstalledModel {
  modelPath: string;
  vadPath: string;
}

/** Paths of the verified model + VAD, or null until both are downloaded. */
export function getInstalledModel(): InstalledModel | null {
  const [model, vad] = WHISPER_FILES;
  if (!isInstalled(model) || !isInstalled(vad)) return null;
  return { modelPath: filePath(model), vadPath: filePath(vad) };
}

export type WhisperModelState = "missing" | "downloading" | "ready" | "error";

export interface WhisperModelStatus {
  state: WhisperModelState;
  model_id: string;
  bytes_done: number;
  bytes_total: number;
  error?: string;
}

let download: { bytesDone: number; promise: Promise<void> } | null = null;
let lastError: string | null = null;

export function getModelStatus(): WhisperModelStatus {
  const base = { model_id: WHISPER_MODEL_ID, bytes_total: TOTAL_BYTES };
  if (getInstalledModel()) return { ...base, state: "ready", bytes_done: TOTAL_BYTES };
  if (download) return { ...base, state: "downloading", bytes_done: download.bytesDone };
  if (lastError) return { ...base, state: "error", bytes_done: 0, error: lastError };
  return { ...base, state: "missing", bytes_done: 0 };
}

/**
 * Start downloading whatever is missing. Returns immediately; a second call
 * while a download runs joins it. Progress is read with `getModelStatus()`.
 */
export function startModelDownload(): Promise<void> {
  if (download) return download.promise;
  lastError = null;
  const state = { bytesDone: 0, promise: Promise.resolve() };
  state.promise = (async () => {
    await fsp.mkdir(modelsDir(), { recursive: true });
    for (const f of WHISPER_FILES) {
      if (isInstalled(f)) {
        state.bytesDone += f.sizeBytes;
        continue;
      }
      const before = state.bytesDone;
      await downloadFile(f, (n) => {
        state.bytesDone = before + n;
      });
    }
  })()
    .catch((err: unknown) => {
      lastError = err instanceof Error ? err.message : String(err);
      throw err;
    })
    .finally(() => {
      download = null;
    });
  download = state;
  // Callers that only start the download must not see an unhandled rejection.
  state.promise.catch(() => undefined);
  return state.promise;
}

async function downloadFile(f: WhisperModelFile, onBytes: (n: number) => void): Promise<void> {
  const finalPath = filePath(f);
  const partPath = `${finalPath}.part`;
  await fsp.rm(partPath, { force: true });

  const res = await fetch(f.url);
  if (!res.ok || !res.body) throw new Error(`הורדת מודל התמלול נכשלה (HTTP ${res.status})`);

  const hash = crypto.createHash("sha256");
  const out = fs.createWriteStream(partPath);
  const reader = res.body.getReader();
  let done = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      hash.update(chunk.value);
      done += chunk.value.byteLength;
      if (!out.write(chunk.value)) await new Promise<void>((r) => out.once("drain", () => r()));
      onBytes(done);
    }
  } finally {
    await new Promise<void>((resolve) => out.end(resolve));
  }

  const actual = hash.digest("hex");
  if (actual !== f.sha256) {
    await fsp.rm(partPath, { force: true });
    throw new Error(`קובץ המודל שהורד פגום (sha256 ${actual.slice(0, 12)}…). נסה שוב.`);
  }
  await fsp.rename(partPath, finalPath);
  await fsp.writeFile(markerPath(f), actual, "utf8");
}

/** Test hook: forget in-flight download state between tests. */
export function resetModelDownloadForTests(): void {
  download = null;
  lastError = null;
}
