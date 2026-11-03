// Page side of Hebrew transcription: owns the ASR worker, answers its model
// cache requests from the library folder, tracks download progress for the
// Settings card, and turns an audio file into 16 kHz mono samples.

import AsrWorker from "./asr.worker.ts?worker&inline";
import * as folder from "../runtime/folder";
import { webFs, RUNTIME_DIR } from "../runtime/vfs";

export const MODEL_ID = "ivrit-ai/whisper-large-v3-turbo";
const READY_MARKER = `${RUNTIME_DIR}/whisper-ready.json`;
/** Download size of the q4 weights (encoder 425 MB + decoder 334 MB + configs). */
const EXPECTED_BYTES = { webgpu: 762_000_000, wasm: 762_000_000 } as const;

export type AsrDevice = "webgpu" | "wasm";

export interface AsrChunk {
  timestamp: [number, number | null];
  text: string;
}

let worker: Worker | null = null;
let device: AsrDevice | null = null;
let loading: Promise<void> | null = null;
let lastError: string | null = null;
const progress = new Map<string, { loaded: number; total: number }>();
const waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
let nextId = 1;

/** URL of a model file → its path under `.weatherv1/models/`. */
export function cachePath(url: string): string {
  const u = new URL(url);
  const clean = `${u.hostname}${u.pathname}`.replace(/\/resolve\/[^/]+\//, "/").replace(/[^A-Za-z0-9._/-]/g, "_");
  return `.weatherv1/models/${clean}`;
}

async function pickDevice(): Promise<AsrDevice> {
  if (device) return device;
  const forced = new URLSearchParams(window.location.search).get("asrDevice");
  if (forced === "wasm" || forced === "webgpu") return (device = forced);
  try {
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<{ features: Set<string> } | null> } }).gpu;
    const adapter = (await gpu?.requestAdapter()) as
      | ({ features: Set<string>; info?: { vendor?: string; architecture?: string; description?: string } } | null)
      | undefined;
    device = adapter ? "webgpu" : "wasm";
    console.info(
      `[asr] device ${device}${adapter ? ` (${adapter.info?.vendor ?? "?"} ${adapter.info?.architecture ?? ""} ${adapter.info?.description ?? ""}, f16=${adapter.features.has("shader-f16")})` : ""}`,
    );
  } catch {
    device = "wasm";
  }
  return device;
}

function getWorker(): Worker {
  if (worker) return worker;
  worker = new AsrWorker();
  // A worker that fails to start (bad import, no WASM) never answers a call:
  // fail every waiting call instead of hanging the transcription forever.
  worker.onerror = (e: ErrorEvent) => {
    const err = new Error(`מנוע התמלול לא עלה: ${e.message || "שגיאה לא ידועה"}`);
    console.error("[asr] worker error:", e.message, e.filename, e.lineno);
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
    worker?.terminate();
    worker = null;
  };
  worker.onmessage = async (e: MessageEvent) => {
    const msg = e.data;
    if (msg.type === "cache-get") {
      let value: ArrayBuffer | null = null;
      try {
        value = await (await folder.readFile(cachePath(msg.url))).arrayBuffer();
      } catch {
        value = null;
      }
      worker!.postMessage({ type: "cache-reply", id: msg.id, ok: true, value }, value ? [value] : []);
    } else if (msg.type === "cache-put") {
      try {
        await folder.writeFile(cachePath(msg.url), msg.body as ArrayBuffer);
        worker!.postMessage({ type: "cache-reply", id: msg.id, ok: true });
      } catch (err) {
        worker!.postMessage({ type: "cache-reply", id: msg.id, ok: false, error: String(err) });
      }
    } else if (msg.type === "progress") {
      if (!progress.has(msg.file)) console.info(`[asr] downloading ${msg.file}`);
      progress.set(msg.file, { loaded: msg.loaded, total: msg.total });
    } else if (msg.type === "log") {
      console.info(`[asr] ${msg.text}`);
    } else if (msg.type === "loaded" || msg.type === "result") {
      waiting.get(msg.id)?.resolve(msg);
      waiting.delete(msg.id);
    } else if (msg.type === "error") {
      waiting.get(msg.id)?.reject(new Error(msg.error));
      waiting.delete(msg.id);
    }
  };
  return worker;
}

/** Debug overrides from the page URL: `?asrDtype=enc,dec&asrWords=1`. */
function overrides(): {
  dtypes?: { encoder_model: string; decoder_model_merged: string };
  words?: boolean;
  model?: string;
} {
  const q = new URLSearchParams(window.location.search);
  const d = q.get("asrDtype")?.split(",");
  return {
    dtypes: d?.length === 2 ? { encoder_model: d[0], decoder_model_merged: d[1] } : undefined,
    words: q.has("asrWords") ? q.get("asrWords") === "1" : undefined,
    model: q.get("asrModel") ?? undefined,
  };
}

function call<T>(message: Record<string, unknown>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    waiting.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...overrides(), ...message, id }, transfer);
  });
}

export function isModelReady(): boolean {
  return webFs.existsSync(READY_MARKER);
}

/** Download (first time) and load the model. Safe to call repeatedly. */
export function ensureModel(): Promise<void> {
  if (!loading) {
    lastError = null;
    loading = (async () => {
      const dev = await pickDevice();
      await call({ type: "load", device: dev });
      webFs.mkdirSync(RUNTIME_DIR, { recursive: true });
      webFs.writeFileSync(READY_MARKER, JSON.stringify({ model: MODEL_ID, device: dev, at: new Date().toISOString() }));
    })().catch((err: unknown) => {
      lastError = err instanceof Error ? err.message : String(err);
      loading = null;
      throw err;
    });
  }
  return loading;
}

export interface ModelProgress {
  state: "missing" | "downloading" | "ready" | "error";
  bytesDone: number;
  bytesTotal: number;
  error?: string;
}

export function modelProgress(): ModelProgress {
  const files = [...progress.values()];
  const done = files.reduce((s, f) => s + f.loaded, 0);
  const reported = files.reduce((s, f) => s + f.total, 0);
  const total = Math.max(reported, EXPECTED_BYTES[device ?? "webgpu"]);
  if (isModelReady() && !loading) return { state: "ready", bytesDone: total, bytesTotal: total };
  if (lastError) return { state: "error", bytesDone: 0, bytesTotal: total, error: lastError };
  if (loading) return { state: done >= total ? "ready" : "downloading", bytesDone: Math.min(done, total), bytesTotal: total };
  return { state: "missing", bytesDone: 0, bytesTotal: total };
}

/** Decode any audio file to 16 kHz mono samples (Whisper's input). */
export async function decodeTo16kMono(bytes: ArrayBuffer): Promise<Float32Array> {
  const ctx = new OfflineAudioContext(1, 1, 16_000);
  const buf = await ctx.decodeAudioData(bytes);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0).slice();
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < ch.length; i++) out[i] += ch[i] / buf.numberOfChannels;
  }
  return out;
}

export async function transcribeSamples(audio: Float32Array): Promise<{ text: string; chunks: AsrChunk[]; device: AsrDevice }> {
  await ensureModel();
  const dev = await pickDevice();
  let peak = 0;
  for (let i = 0; i < audio.length; i += 97) peak = Math.max(peak, Math.abs(audio[i]));
  console.info(`[asr] transcribing ${(audio.length / 16_000).toFixed(1)}s of audio, peak ${peak.toFixed(3)}`);
  const res = await call<{ text: string; chunks: AsrChunk[] }>({ type: "transcribe", device: dev, audio }, [audio.buffer]);
  console.info(`[asr] text ${res.text.length} chars, ${res.chunks.length} chunks: ${JSON.stringify(res).slice(0, 600)}`);
  return { text: res.text, chunks: res.chunks, device: dev };
}
