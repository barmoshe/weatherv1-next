// Transcription provider abstraction. One implementation ships: local
// whisper.cpp with a Hebrew model (`whisper-local.ts`). The provider shape
// keeps plan-bundle storage and the scene planner independent of the engine.

import type { WhisperSegment } from "@/shared/types";

export type TranscriptionProviderId = "local-whisper";

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  duration: number;
  /** Model id that produced the transcript (recorded on the job). */
  transcription_model: string;
  /** Audio seconds billed by a paid API; 0 for local transcription. */
  billed_audio_sec: number;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  /**
   * Transcribe an audio file from disk. The file is expected to live inside
   * the runtime uploads dir.
   */
  transcribe(audioPath: string): Promise<TranscriptionResult>;
}

export type TranscriptionErrorCode =
  | "transcription_no_model"
  | "transcription_binary_missing"
  | "transcription_failed";

export class TranscriptionProviderError extends Error {
  constructor(
    message: string,
    public readonly code: TranscriptionErrorCode,
    public readonly provider: TranscriptionProviderId,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "TranscriptionProviderError";
  }
}
