// Hebrew speech recognition off the main thread: transformers.js running the
// ivrit-ai Whisper large-v3-turbo ONNX export, on WebGPU when the machine has
// it and on single-threaded WASM otherwise, q4 weights (~760 MB) either way.
//
// Model files are cached in the library folder, not the browser: the worker
// has no folder access of its own, so its cache asks the page (`cache-get`,
// `cache-put` messages) and the page reads/writes `.weatherv1/models/`.

import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from "@huggingface/transformers";

export const MODEL_REPO = "ivrit-ai/whisper-large-v3-turbo-onnx";

type Rpc = { id: number; ok: boolean; value?: ArrayBuffer | null; error?: string };
const pending = new Map<number, (r: Rpc) => void>();
let nextId = 1;

function ask(type: "cache-get" | "cache-put", url: string, body?: ArrayBuffer): Promise<Rpc> {
  const id = nextId++;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    (self as unknown as Worker).postMessage({ type, id, url, body }, body ? [body] : []);
  });
}

env.allowLocalModels = false;
env.useBrowserCache = false;
env.useCustomCache = true;
env.customCache = {
  async match(request: string | Request) {
    const url = typeof request === "string" ? request : request.url;
    const r = await ask("cache-get", url);
    return r.ok && r.value ? new Response(r.value) : undefined;
  },
  async put(request: string | Request, response: Response) {
    const url = typeof request === "string" ? request : request.url;
    await ask("cache-put", url, await response.arrayBuffer());
  },
};
const onnx = env.backends.onnx as { wasm?: { numThreads?: number } };
if (onnx.wasm) onnx.wasm.numThreads = 1; // no SharedArrayBuffer on file://

let asr: Promise<AutomaticSpeechRecognitionPipeline> | null = null;
self.postMessage({ type: "log", text: "worker started" });

type Dtypes = { encoder_model: string; decoder_model_merged: string };

function load(device: "webgpu" | "wasm", override?: Dtypes, repo: string = MODEL_REPO) {
  if (!asr) {
    // q4 everywhere: q4f16 (fp16 math) produced garbage on a real WebGPU
    // adapter in testing, and q4 also runs on GPUs without shader-f16.
    const fallback = "q4";
    const dtypes = override ?? { encoder_model: fallback, decoder_model_merged: fallback };
    const dtype = `${dtypes.encoder_model}/${dtypes.decoder_model_merged}`;
    self.postMessage({ type: "log", text: `loading ${repo} on ${device} (${dtype})` });
    asr = pipeline("automatic-speech-recognition", repo, {
      device,
      dtype: dtypes as never,
      progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.file) {
          self.postMessage({ type: "progress", file: p.file, loaded: p.loaded ?? 0, total: p.total ?? 0 });
        }
      },
    }) as Promise<AutomaticSpeechRecognitionPipeline>;
    asr.catch(() => {
      asr = null;
    });
  }
  return asr;
}

self.onmessage = async (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === "cache-reply") {
    pending.get(msg.id)?.(msg);
    pending.delete(msg.id);
    return;
  }
  try {
    if (msg.type === "load") {
      await load(msg.device, msg.dtypes, msg.model);
      self.postMessage({ type: "loaded", id: msg.id });
      return;
    }
    if (msg.type === "transcribe") {
      const run = await load(msg.device, msg.dtypes, msg.model);
      const out = (await run(msg.audio as Float32Array, {
        language: "hebrew",
        task: "transcribe",
        return_timestamps: msg.words ? "word" : true,
        chunk_length_s: 30,
        stride_length_s: 5,
      })) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
      self.postMessage({ type: "result", id: msg.id, text: out.text, chunks: out.chunks ?? [] });
    }
  } catch (err) {
    self.postMessage({ type: "error", id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
};
