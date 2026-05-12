// Transcription provider abstraction. We currently ship one implementation —
// OpenAI cloud Whisper — but keep the provider shape so the rest of the
// pipeline (plan-bundle storage, scene planner) doesn't depend on the
// concrete vendor. If we re-add a local engine later, drop a second
// `TranscriptionProvider` impl behind a new id.

import type { WhisperSegment } from "@/shared/types";

export type TranscriptionProviderId = "openai-cloud";

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  duration: number;
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
  | "transcription_invalid_key"
  | "transcription_quota_exceeded"
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
