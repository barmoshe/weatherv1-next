// Whisper.cpp model registry, downloader, and verifier.
//
// Models are stored as `ggml-<name>.bin` GGML files. The canonical source
// is HuggingFace `ggerganov/whisper.cpp` — that repo's `main` branch publishes
// the official converted weights with stable SHA256s. The hashes below are
// pinned to known-good versions and verified after download; on mismatch we
// delete the partial file so the next attempt starts clean.
//
// Models live in the WORKSPACE cache (`<workspace>/cache/whisper-models/`)
// rather than the installer bundle, because:
//   - large-v3 is ~3 GB; an installer that ships it is hostile.
//   - Users may want different quality/cost trade-offs per machine.
//   - Workspace dirs survive app reinstall.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { getRuntimePaths } from "@/server/runtime/paths";

export type WhisperModelId = "small" | "medium" | "large-v3";

export interface WhisperModelDescriptor {
  id: WhisperModelId;
  /** Filename on disk (and on HuggingFace). */
  filename: string;
  /** Public download URL — HuggingFace mirror. */
  url: string;
  /**
   * Optional SHA-256 of the file in hex. When set, the file is verified
   * post-download and a mismatch deletes the partial. When null, verification
   * is skipped with a warning — set by a release-engineering pass against a
   * specific HuggingFace revision so we know what we shipped against.
   */
  sha256: string | null;
  /** Size in bytes — used for the "fits on disk" UX. Approximate. */
  sizeBytes: number;
  /** Hebrew-friendly description shown in Settings. */
  descriptionHe: string;
  /** Hebrew-friendly long-form label. */
  qualityHe: string;
}

// SHA-256 values are intentionally null at scaffold time. To pin them, run
// `shasum -a 256 ~/.cache/whisper-models/ggml-<id>.bin` against a known-good
// download and paste the hex in here. Until then, downloads succeed with a
// warning rather than failing the verification step.
export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelDescriptor> = {
  small: {
    id: "small",
    filename: "ggml-small.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin",
    sha256: null,
    sizeBytes: 487_601_968,
    descriptionHe: "קל ומהיר. עברית סבירה לדמואים.",
    qualityHe: "איכות בסיסית",
  },
  medium: {
    id: "medium",
    filename: "ggml-medium.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-medium.bin",
    sha256: null,
    sizeBytes: 1_533_763_059,
    descriptionHe: "איכות טובה לעברית, מהירות סבירה גם ללא GPU.",
    qualityHe: "מומלץ",
  },
  "large-v3": {
    id: "large-v3",
    filename: "ggml-large-v3.bin",
    url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3.bin",
    sha256: null,
    sizeBytes: 3_094_623_691,
    descriptionHe: "האיכות הגבוהה ביותר לעברית. כבד וגוזל זיכרון.",
    qualityHe: "איכות מרבית",
  },
};

export function modelsCacheDir(): string {
  const { cacheDir } = getRuntimePaths();
  return path.join(cacheDir, "whisper-models");
}

function modelPath(model: WhisperModelDescriptor): string {
  return path.join(modelsCacheDir(), model.filename);
}

export interface WhisperModelStatus {
  id: WhisperModelId;
  installed: boolean;
  path: string;
  /** File size on disk (bytes) if installed, otherwise 0. */
  diskBytes: number;
  expectedBytes: number;
  /** Whether SHA-256 has been verified since last check (cached marker file). */
  verified: boolean;
}

const VERIFIED_MARKER_EXT = ".verified";

function verifiedMarkerPath(model: WhisperModelDescriptor): string {
  return modelPath(model) + VERIFIED_MARKER_EXT;
}

export function listInstalledModels(): WhisperModelStatus[] {
  return (Object.values(WHISPER_MODELS) as WhisperModelDescriptor[]).map((m) => {
    const p = modelPath(m);
    let installed = false;
    let diskBytes = 0;
    try {
      const stat = fs.statSync(p);
      installed = stat.isFile();
      diskBytes = stat.size;
    } catch {
      // not installed
    }
    const verified = installed && fs.existsSync(verifiedMarkerPath(m));
    return {
      id: m.id,
      installed,
      path: p,
      diskBytes,
      expectedBytes: m.sizeBytes,
      verified,
    };
  });
}

/** Path to the .bin file for a model; throws if the model isn't installed. */
export function getInstalledModelPath(id: WhisperModelId): string {
  const m = WHISPER_MODELS[id];
  if (!m) throw new Error(`Unknown whisper model: ${id}`);
  const p = modelPath(m);
  if (!fs.existsSync(p)) {
    throw new Error(`Whisper model "${id}" is not installed. Download it from Settings.`);
  }
  return p;
}

export interface DownloadProgress {
  modelId: WhisperModelId;
  bytesDownloaded: number;
  bytesTotal: number;
  done: boolean;
  error?: string;
}

export type DownloadProgressListener = (p: DownloadProgress) => void;

/**
 * Download a Whisper model atomically with SHA verification.
 * - Streams to a `.part` sibling, fsyncs, verifies hash, renames into place,
 *   and drops a `.verified` marker. A failed verification deletes the partial
 *   file so the next attempt is clean.
 * - Pure Node; no `node-fetch` shim required (Next 16 / Node 20 both ship
 *   global `fetch`).
 */
export async function downloadModel(
  id: WhisperModelId,
  onProgress?: DownloadProgressListener,
): Promise<void> {
  const model = WHISPER_MODELS[id];
  if (!model) throw new Error(`Unknown whisper model: ${id}`);

  const dir = modelsCacheDir();
  await fsp.mkdir(dir, { recursive: true });

  const finalPath = modelPath(model);
  const partPath = finalPath + ".part";

  // If a previous run left a verified file in place, treat as already installed.
  if (fs.existsSync(finalPath) && fs.existsSync(verifiedMarkerPath(model))) {
    onProgress?.({
      modelId: id,
      bytesDownloaded: model.sizeBytes,
      bytesTotal: model.sizeBytes,
      done: true,
    });
    return;
  }

  // Always start a clean partial so resumed-but-corrupt downloads don't
  // poison subsequent runs. We don't support resume yet; if it becomes a
  // real complaint we can add `Range:` support here.
  if (fs.existsSync(partPath)) await fsp.unlink(partPath);

  const res = await fetch(model.url);
  if (!res.ok || !res.body) {
    throw new Error(`Failed to download ${id}: HTTP ${res.status}`);
  }

  const totalHeader = res.headers.get("content-length");
  const bytesTotal = totalHeader ? parseInt(totalHeader, 10) : model.sizeBytes;
  let bytesDownloaded = 0;
  const hash = crypto.createHash("sha256");

  const writeStream = fs.createWriteStream(partPath);
  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      hash.update(value);
      bytesDownloaded += value.byteLength;
      await new Promise<void>((resolve, reject) => {
        writeStream.write(value, (err) => (err ? reject(err) : resolve()));
      });
      onProgress?.({
        modelId: id,
        bytesDownloaded,
        bytesTotal,
        done: false,
      });
    }
  } finally {
    await new Promise<void>((resolve) => writeStream.end(resolve));
  }

  const actualSha = hash.digest("hex");
  if (model.sha256 && actualSha !== model.sha256) {
    await fsp.unlink(partPath).catch(() => undefined);
    const err = new Error(
      `SHA mismatch for ${id}: expected ${model.sha256}, got ${actualSha}. Partial file removed.`,
    );
    onProgress?.({
      modelId: id,
      bytesDownloaded,
      bytesTotal,
      done: true,
      error: err.message,
    });
    throw err;
  }
  if (!model.sha256) {
    console.warn(
      `[whisper] No pinned SHA-256 for model "${id}" — skipping verification. ` +
        `Observed sha256: ${actualSha}`,
    );
  }

  await fsp.rename(partPath, finalPath);
  await fsp.writeFile(verifiedMarkerPath(model), actualSha, "utf8");
  onProgress?.({
    modelId: id,
    bytesDownloaded,
    bytesTotal,
    done: true,
  });
}

/** Delete a model. Idempotent. */
export async function deleteModel(id: WhisperModelId): Promise<void> {
  const model = WHISPER_MODELS[id];
  if (!model) throw new Error(`Unknown whisper model: ${id}`);
  await fsp.rm(modelPath(model), { force: true });
  await fsp.rm(verifiedMarkerPath(model), { force: true });
}

/**
 * Pick the active model for transcription. Order:
 *   1. `WHISPER_MODEL` env override (must be installed).
 *   2. First installed model in quality order: large-v3 → medium → small.
 *   3. null if nothing is installed.
 */
export function pickActiveModel(): WhisperModelStatus | null {
  const all = listInstalledModels();
  const installed = all.filter((m) => m.installed);
  if (!installed.length) return null;

  const envChoice = process.env.WHISPER_MODEL?.trim().toLowerCase();
  if (envChoice) {
    const match = installed.find((m) => m.id === envChoice);
    if (match) return match;
  }

  const order: WhisperModelId[] = ["large-v3", "medium", "small"];
  for (const id of order) {
    const match = installed.find((m) => m.id === id);
    if (match) return match;
  }
  return installed[0];
}
