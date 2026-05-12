// Transcription provider selection.
//
// Cloud-only path: we use OpenAI's hosted Whisper. A local ONNX-based
// alternative landed briefly but added per-platform binary distribution
// complexity that wasn't worth it. The provider interface is preserved
// so a future local engine can slot back in without touching call sites.

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
}

export function getTranscriptionProvider(
  config?: TranscriptionProviderConfig,
): TranscriptionProvider {
  const cfg: TranscriptionProviderConfig = config ?? configFromEnv();
  if (!cfg.openaiKey) {
    throw new TranscriptionProviderError(
      "OPENAI_API_KEY is required for transcription. Open Settings and add the key.",
      "transcription_invalid_key",
      "openai-cloud",
    );
  }
  return createOpenAiTranscriptionProvider({ apiKey: cfg.openaiKey });
}

function configFromEnv(): TranscriptionProviderConfig {
  return {
    openaiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
  };
}
