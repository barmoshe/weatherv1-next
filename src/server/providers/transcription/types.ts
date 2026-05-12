// Transcription provider abstraction.
//
// Both providers (local whisper.cpp, cloud OpenAI Whisper) return the same
// shape so the rest of the pipeline (plan-bundle storage, scene planner)
// doesn't need to know which one ran.

import type { WhisperSegment } from "@/shared/types";

export type TranscriptionProviderId = "local-whispercpp" | "openai-cloud";

export interface TranscriptionResult {
  text: string;
  segments: WhisperSegment[];
  duration: number;
}

export interface TranscriptionProvider {
  readonly id: TranscriptionProviderId;
  /**
   * Transcribe an audio file from disk. The file is expected to live inside
   * the runtime uploads dir so the implementation can reuse it for ffmpeg
   * preprocessing (16 kHz mono WAV conversion for whisper.cpp).
   */
  transcribe(audioPath: string): Promise<TranscriptionResult>;
}

export type TranscriptionErrorCode =
  | "transcription_invalid_key"
  | "transcription_quota_exceeded"
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
