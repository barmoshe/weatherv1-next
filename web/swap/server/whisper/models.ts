// Browser build: the Hebrew model is the ivrit-ai ONNX export, downloaded by
// transformers.js into the library folder (web/media/asr.ts). Same exports
// as the Electron module, so /api/whisper and /api/desktop/status work as-is.

import { MODEL_ID, ensureModel, isModelReady, modelProgress } from "../../../media/asr";

export const WHISPER_MODEL_ID = MODEL_ID;

export interface InstalledModel {
  modelPath: string;
  vadPath: string;
}

export function getInstalledModel(): InstalledModel | null {
  return isModelReady() ? { modelPath: "browser", vadPath: "browser" } : null;
}

export type WhisperModelState = "missing" | "downloading" | "ready" | "error";

export interface WhisperModelStatus {
  state: WhisperModelState;
  model_id: string;
  bytes_done: number;
  bytes_total: number;
  error?: string;
}

export function getModelStatus(): WhisperModelStatus {
  const p = modelProgress();
  return { state: p.state, model_id: MODEL_ID, bytes_done: p.bytesDone, bytes_total: p.bytesTotal, error: p.error };
}

export function startModelDownload(): Promise<void> {
  const run = ensureModel();
  run.catch(() => undefined);
  return run;
}
