// Transcription provider selection.
//
// Selection rules (first match wins):
//   1. Explicit pin via `TRANSCRIPTION_PROVIDER` env. Errors if its
//      prerequisites aren't met (no local model installed / no API key).
//   2. Auto: prefer local Whisper ONNX if at least one model is cached on
//      disk, otherwise fall back to OpenAI cloud if a key is set.
//   3. Nothing usable → throw with an actionable Hebrew message.

import { isLocalWhisperPlatformSupported, pickActiveModel } from "@/server/whisper/models";
import { createLocalWhisperProvider } from "./whisper-onnx";
import { createOpenAiTranscriptionProvider } from "./openai-cloud";
import {
  type TranscriptionProvider,
  type TranscriptionProviderId,
  TranscriptionProviderError,
} from "./types";

export type {
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionErrorCode,
} from "./types";
export { TranscriptionProviderError } from "./types";

export interface TranscriptionProviderConfig {
  openaiKey?: string;
  preferred?: TranscriptionProviderId | "auto";
}

export function getTranscriptionProvider(
  config?: TranscriptionProviderConfig,
): TranscriptionProvider {
  const cfg: TranscriptionProviderConfig = config ?? configFromEnv();
  const preferred = cfg.preferred ?? "auto";

  if (preferred === "local-whisper-onnx") {
    requireLocalReady();
    return createLocalWhisperProvider();
  }
  if (preferred === "openai-cloud") {
    if (!cfg.openaiKey) {
      throw new TranscriptionProviderError(
        "TRANSCRIPTION_PROVIDER=openai-cloud but OPENAI_API_KEY is not configured",
        "transcription_invalid_key",
        "openai-cloud",
      );
    }
    return createOpenAiTranscriptionProvider({ apiKey: cfg.openaiKey });
  }

  if (isLocalReady()) {
    return createLocalWhisperProvider();
  }
  if (cfg.openaiKey) {
    return createOpenAiTranscriptionProvider({ apiKey: cfg.openaiKey });
  }

  throw new TranscriptionProviderError(
    "No transcription provider available. Download a local Whisper model in Settings, or set OPENAI_API_KEY.",
    "transcription_no_model",
    "local-whisper-onnx",
  );
}

function isLocalReady(): boolean {
  return isLocalWhisperPlatformSupported() && Boolean(pickActiveModel());
}

function requireLocalReady(): void {
  if (!isLocalWhisperPlatformSupported()) {
    throw new TranscriptionProviderError(
      "Local Whisper isn't supported on this platform/arch in v0.1.x. Use OPENAI_API_KEY for cloud transcription.",
      "transcription_no_model",
      "local-whisper-onnx",
    );
  }
  if (!pickActiveModel()) {
    throw new TranscriptionProviderError(
      "TRANSCRIPTION_PROVIDER=local-whisper-onnx but no Whisper model is installed",
      "transcription_no_model",
      "local-whisper-onnx",
    );
  }
}

function configFromEnv(): TranscriptionProviderConfig {
  const preferredRaw = process.env.TRANSCRIPTION_PROVIDER?.trim().toLowerCase();
  const preferred: TranscriptionProviderConfig["preferred"] =
    preferredRaw === "local-whisper-onnx" || preferredRaw === "openai-cloud"
      ? preferredRaw
      : "auto";
  return {
    openaiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    preferred,
  };
}
