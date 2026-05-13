// Cloud OpenAI Whisper transcription provider.
//
// Direct lift of the pre-provider-layer logic from `pipeline/picker.ts`:
//   `whisper-1` with `language: "he"` + the Hebrew weather prompt,
//   `verbose_json` so we get segment timestamps for downstream scene
//   planning.

import OpenAI from "openai";
import fs from "node:fs";
import { WHISPER_HE_PROMPT, fixTranscript } from "@/server/pipeline/transcript-fixes";
import type { WhisperSegment } from "@/shared/types";
import {
  type TranscriptionProvider,
  type TranscriptionResult,
  TranscriptionProviderError,
} from "./types";

export interface OpenAiTranscriptionProviderOptions {
  apiKey: string;
}

export function createOpenAiTranscriptionProvider(
  opts: OpenAiTranscriptionProviderOptions,
): TranscriptionProvider {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    throw new TranscriptionProviderError(
      "OPENAI_API_KEY is required for cloud transcription",
      "transcription_invalid_key",
      "openai-cloud",
    );
  }
  const client = new OpenAI({ apiKey });

  return {
    id: "openai-cloud",
    async transcribe(audioPath: string): Promise<TranscriptionResult> {
      try {
        const audioStream = fs.createReadStream(audioPath);
        const transcript = await client.audio.transcriptions.create({
          model: "whisper-1",
          file: audioStream,
          response_format: "verbose_json",
          language: "he",
          prompt: WHISPER_HE_PROMPT,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any);

        const raw = transcript as unknown as {
          text: string;
          segments?: Array<{ start: number; end: number; text: string }>;
          duration?: number;
        };

        const fixedText = fixTranscript(raw.text ?? "");
        const segments: WhisperSegment[] = (raw.segments ?? []).map((s, i) => ({
          idx: i,
          start: s.start,
          end: s.end,
          text: fixTranscript(s.text ?? ""),
        }));
        const duration =
          raw.duration ?? (segments.length ? segments[segments.length - 1].end : 0);
        const transcription_model = "whisper-1";
        return {
          text: fixedText,
          segments,
          duration,
          transcription_model,
          billed_audio_sec: duration,
        };
      } catch (err) {
        throw translate(err);
      }
    },
  };
}

function translate(err: unknown): TranscriptionProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("billing_hard_limit_reached")
  ) {
    return new TranscriptionProviderError(
      "OpenAI quota exceeded",
      "transcription_quota_exceeded",
      "openai-cloud",
      err,
    );
  }
  if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
    return new TranscriptionProviderError(
      "OpenAI API key is invalid",
      "transcription_invalid_key",
      "openai-cloud",
      err,
    );
  }
  return new TranscriptionProviderError(
    `OpenAI Whisper call failed: ${msg}`,
    "transcription_failed",
    "openai-cloud",
    err,
  );
}
