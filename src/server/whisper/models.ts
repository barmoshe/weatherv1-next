// Whisper ONNX model registry, downloader, and verifier.
//
// We run Whisper via `@huggingface/transformers` (transformers.js v4), which
// uses ONNX Runtime under the hood. Models live as a folder tree on HuggingFace
// (config.json, tokenizer, encoder/decoder ONNX files, optional quantized
// variants). transformers.js streams them into a local cache directory the
// first time the pipeline is constructed.
//
// We point that cache at the workspace's runtime cache so:
//   - Model files survive app reinstalls (they're outside `app.asar.unpacked`).
//   - Switching workspaces switches model caches (intended — workspaces are
//     the unit of "settings" for this app).
//   - The downloader and runtime pipeline share the same files. There is no
//     separate download step on disk; we just call the same loader the
//     transcriber would call, with a progress callback.

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";

export type WhisperModelId = "small" | "medium" | "large-v3-turbo";

export interface WhisperModelDescriptor {
  id: WhisperModelId;
  /** HuggingFace repo id (`<org>/<name>`) passed to `pipeline()`. */
  repo: string;
  /**
   * Subdir transformers.js writes into under `env.cacheDir`. This is
   * `<org>--<name>` (slash → double-dash), matching transformers.js's hash
   * scheme so we can detect "installed" without re-downloading.
   */
  cacheKey: string;
  /** Quantization to ask transformers.js to load. Smaller = less RAM. */
  dtype: "fp32" | "fp16" | "q8" | "q4" | "int8";
  /** Approx total bytes on disk after download (encoder + decoder + tokens). */
  sizeBytes: number;
  /** Hebrew-friendly short description shown in Settings. */
  descriptionHe: string;
  /** Hebrew-friendly "quality" label shown next to it. */
  qualityHe: string;
}

// Registry — pinned to Xenova / onnx-community variants that are known to
// load on transformers.js without manual conversion. Sizes are approximate
// (transformers.js downloads quantized variants which are smaller than the
// full PyTorch weights). Bump these as the upstream repos evolve.
export const WHISPER_MODELS: Record<WhisperModelId, WhisperModelDescriptor> = {
  small: {
    id: "small",
    repo: "Xenova/whisper-small",
    cacheKey: "Xenova--whisper-small",
    dtype: "q8",
    sizeBytes: 250_000_000, // ~250 MB quantized encoder+decoder
    descriptionHe: "קל ומהיר. עברית סבירה לדמואים ולקטעים קצרים.",
    qualityHe: "איכות בסיסית",
  },
  medium: {
    id: "medium",
    repo: "Xenova/whisper-medium",
    cacheKey: "Xenova--whisper-medium",
    dtype: "q8",
    sizeBytes: 850_000_000, // ~850 MB quantized
    descriptionHe: "איכות טובה לעברית. ברירת המחדל המומלצת.",
    qualityHe: "מומלץ",
  },
  "large-v3-turbo": {
    id: "large-v3-turbo",
    repo: "onnx-community/whisper-large-v3-turbo_timestamped",
    cacheKey: "onnx-community--whisper-large-v3-turbo_timestamped",
    dtype: "q4",
    sizeBytes: 1_600_000_000, // ~1.6 GB q4
    descriptionHe: "האיכות הגבוהה ביותר לעברית, מאומן לזמני סגמנט מדויקים.",
    qualityHe: "איכות מרבית",
  },
};

/** Root cache directory we hand to `env.cacheDir`. */
export function modelsCacheDir(): string {
  const { cacheDir } = getRuntimePaths();
  return path.join(cacheDir, "whisper-onnx");
}

/**
 * Whether `onnxruntime-node` has a prebuilt native binding for the current
 * platform/arch. The library hard-requires
 * `bin/napi-v6/${platform}/${arch}/onnxruntime_binding.node` at import time —
 * if that file is missing the entire transcription path crashes before
 * we ever see a useful error.
 *
 * `1.24.x` shipped: linux/{arm64,x64}, win32/{arm64,x64}, darwin/arm64.
 * Notably **no darwin/x64**: Microsoft dropped Intel Mac prebuilds in 1.21+.
 * Until our public Mac build moves to arm64, the local provider has to be
 * disabled for the macOS release (which runs as x64 under Rosetta).
 */
export function isLocalWhisperPlatformSupported(): boolean {
  const plat = process.platform;
  const arch = process.arch;
  if (plat === "darwin" && arch !== "arm64") return false;
  // Everything else we ship for has an onnxruntime-node prebuild.
  return plat === "darwin" || plat === "win32" || plat === "linux";
}

function modelCacheSubdir(model: WhisperModelDescriptor): string {
  // transformers.js v4 hashes the repo id to `<org>/<name>` under cacheDir,
  // not `<org>--<name>`. We try both layouts so the "installed" check is
  // robust across transformers.js versions.
  return path.join(modelsCacheDir(), model.repo);
}

function modelCacheSubdirLegacy(model: WhisperModelDescriptor): string {
  return path.join(modelsCacheDir(), model.cacheKey);
}

const VERIFIED_MARKER = ".weatherv1-verified";

function verifiedMarkerPath(model: WhisperModelDescriptor): string {
  // The marker lives next to the cached repo dir so we can tell "fully
  // downloaded once" from "partial / interrupted download".
  return path.join(modelsCacheDir(), `${model.cacheKey}${VERIFIED_MARKER}`);
}

export interface WhisperModelStatus {
  id: WhisperModelId;
  installed: boolean;
  /** Absolute path the cache uses for this model (may not exist). */
  path: string;
  /** Bytes on disk for the cached subtree. 0 if not installed. */
  diskBytes: number;
  expectedBytes: number;
  /** True if our verified-marker file is present (download completed at least once). */
  verified: boolean;
}

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack: string[] = [dir];
  while (stack.length) {
    const cur = stack.pop() as string;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(cur, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else {
        try {
          total += fs.statSync(p).size;
        } catch {
          // skip
        }
      }
    }
  }
  return total;
}

function pickExistingCachePath(model: WhisperModelDescriptor): string {
  const primary = modelCacheSubdir(model);
  if (fs.existsSync(primary)) return primary;
  const legacy = modelCacheSubdirLegacy(model);
  if (fs.existsSync(legacy)) return legacy;
  return primary;
}

export function listInstalledModels(): WhisperModelStatus[] {
  return (Object.values(WHISPER_MODELS) as WhisperModelDescriptor[]).map((m) => {
    const dir = pickExistingCachePath(m);
    const installed = fs.existsSync(verifiedMarkerPath(m));
    const diskBytes = dirSizeBytes(dir);
    return {
      id: m.id,
      installed,
      path: dir,
      diskBytes,
      expectedBytes: m.sizeBytes,
      verified: installed,
    };
  });
}

export interface DownloadProgress {
  modelId: WhisperModelId;
  bytesDownloaded: number;
  bytesTotal: number;
  done: boolean;
  error?: string;
  /** Optional human-readable status from transformers.js (e.g. "downloading config.json"). */
  status?: string;
}

export type DownloadProgressListener = (p: DownloadProgress) => void;

interface FileProgressEntry {
  loaded: number;
  total: number;
}

// transformers.js emits multiple `ProgressInfo` shapes (initiate, download,
// progress, done, ready, total). We only need a couple of fields off any of
// them; declaring the whole union is brittle (it shifts between minor
// releases), so use a loose accept-anything shape and narrow at runtime.
type TransformersProgress = {
  status: string;
  file?: string;
  name?: string;
  loaded?: number;
  total?: number;
};

/**
 * Download (or verify) a Whisper ONNX model into the workspace cache.
 *
 * Implementation: ask transformers.js to construct the pipeline. The library
 * fetches all required files (encoder/decoder ONNX, tokenizer, config) and
 * caches them under `env.cacheDir`. We translate its file-level progress
 * events into a single aggregate `DownloadProgress` shape that mirrors the
 * old GGML downloader, so the SSE route + UI don't need to change.
 *
 * If the marker file already exists we short-circuit and return — the
 * pipeline construction would still be fast (it just hashes manifests) but
 * skipping it makes the Settings UX snappier.
 */
export async function downloadModel(
  id: WhisperModelId,
  onProgress?: DownloadProgressListener,
): Promise<void> {
  const model = WHISPER_MODELS[id];
  if (!model) throw new Error(`Unknown whisper model: ${id}`);

  const dir = modelsCacheDir();
  await fsp.mkdir(dir, { recursive: true });

  if (fs.existsSync(verifiedMarkerPath(model))) {
    onProgress?.({
      modelId: id,
      bytesDownloaded: model.sizeBytes,
      bytesTotal: model.sizeBytes,
      done: true,
      status: "already-installed",
    });
    return;
  }

  // Lazy import — keeping transformers.js out of the cold path of /api/whisper
  // routes that only list status. The module loads onnxruntime-node and is
  // heavy (~150 ms).
  const { env, pipeline } = await import("@huggingface/transformers");
  env.cacheDir = modelsCacheDir();
  env.allowLocalModels = true;
  env.allowRemoteModels = true;

  const perFile = new Map<string, FileProgressEntry>();
  const lastSent = { downloaded: 0, total: 0 };

  const callback = (info: TransformersProgress) => {
    if (
      info.status === "progress" &&
      typeof info.file === "string" &&
      typeof info.loaded === "number" &&
      typeof info.total === "number"
    ) {
      const entry = perFile.get(info.file) ?? { loaded: 0, total: 0 };
      entry.loaded = info.loaded;
      entry.total = info.total;
      perFile.set(info.file, entry);
    }
    if (info.status === "done" && typeof info.file === "string") {
      const entry = perFile.get(info.file);
      if (entry) entry.loaded = entry.total;
    }

    let downloaded = 0;
    let total = 0;
    for (const entry of perFile.values()) {
      downloaded += entry.loaded;
      total += entry.total;
    }
    if (total <= 0) total = model.sizeBytes;

    // Throttle: only emit when bytes meaningfully change.
    if (
      downloaded !== lastSent.downloaded ||
      total !== lastSent.total
    ) {
      lastSent.downloaded = downloaded;
      lastSent.total = total;
      onProgress?.({
        modelId: id,
        bytesDownloaded: downloaded,
        bytesTotal: total,
        done: false,
        status: info.status,
      });
    }
  };

  try {
    const transcriber = await pipeline("automatic-speech-recognition", model.repo, {
      dtype: model.dtype,
      device: "cpu",
      // The library types the callback against its internal `ProgressInfo`
      // union; we use the narrower shape declared above. Cast through
      // unknown to keep TS quiet without leaking a name from the upstream
      // module surface that may change between minor releases.
      progress_callback: callback as unknown as Parameters<typeof pipeline>[2] extends infer P
        ? P extends { progress_callback?: infer F }
          ? F
          : never
        : never,
    });
    // We don't need to keep the pipeline; the transcription path constructs
    // its own singleton. Free memory here.
    if (typeof transcriber.dispose === "function") {
      await transcriber.dispose();
    }
  } catch (err) {
    onProgress?.({
      modelId: id,
      bytesDownloaded: lastSent.downloaded,
      bytesTotal: lastSent.total || model.sizeBytes,
      done: true,
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await fsp.writeFile(verifiedMarkerPath(model), new Date().toISOString(), "utf8");
  onProgress?.({
    modelId: id,
    bytesDownloaded: lastSent.total || model.sizeBytes,
    bytesTotal: lastSent.total || model.sizeBytes,
    done: true,
  });
}

/** Delete a model's cached files. Idempotent. */
export async function deleteModel(id: WhisperModelId): Promise<void> {
  const model = WHISPER_MODELS[id];
  if (!model) throw new Error(`Unknown whisper model: ${id}`);
  await fsp.rm(modelCacheSubdir(model), { recursive: true, force: true });
  await fsp.rm(modelCacheSubdirLegacy(model), { recursive: true, force: true });
  await fsp.rm(verifiedMarkerPath(model), { force: true });
}

/**
 * Pick the active model for transcription. Order:
 *   1. `WHISPER_MODEL` env override (must be installed).
 *   2. First installed model in quality order: large-v3-turbo → medium → small.
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

  const order: WhisperModelId[] = ["large-v3-turbo", "medium", "small"];
  for (const id of order) {
    const match = installed.find((m) => m.id === id);
    if (match) return match;
  }
  return installed[0];
}

/** Resolve a `WhisperModelId` from an installed-model path; used in tests. */
export function getDescriptor(id: WhisperModelId): WhisperModelDescriptor {
  const m = WHISPER_MODELS[id];
  if (!m) throw new Error(`Unknown whisper model: ${id}`);
  return m;
}
