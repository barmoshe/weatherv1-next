// Transcription provider selection.
//
// Local-only since v0.7.0: whisper.cpp with the ivrit-ai Hebrew model, on the
// editor's own machine. No key, no per-minute bill. The provider interface is
// kept so call sites don't depend on the engine.

import { createLocalWhisperProvider } from "./whisper-local";
import type { TranscriptionProvider } from "./types";

export type {
  TranscriptionProvider,
  TranscriptionProviderId,
  TranscriptionResult,
  TranscriptionErrorCode,
} from "./types";
export { TranscriptionProviderError } from "./types";

export function getTranscriptionProvider(): TranscriptionProvider {
  return createLocalWhisperProvider();
}
