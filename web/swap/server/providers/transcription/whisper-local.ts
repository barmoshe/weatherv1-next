// Browser build: local Hebrew transcription in the page (web/media/asr.ts).
// Same contract as the whisper.cpp provider: segments with start/end in
// seconds, `fixTranscript` applied, nothing billed. The first run downloads
// the model (~760 MB) into the library folder.

import { decodeTo16kMono, transcribeSamples, MODEL_ID, type AsrChunk } from "../../../../media/asr";
import { readExternal } from "../../../../runtime/vfs";
import { fixTranscript } from "@/server/pipeline/transcript-fixes";
import type { WhisperSegment } from "@/shared/types";
import {
  type TranscriptionProvider,
  type TranscriptionResult,
  TranscriptionProviderError,
} from "@/server/providers/transcription/types";

export function createLocalWhisperProvider(): TranscriptionProvider {
  return { id: "local-whisper", transcribe };
}

async function transcribe(audioPath: string): Promise<TranscriptionResult> {
  let samples: Float32Array;
  try {
    samples = await decodeTo16kMono(await (await readExternal(audioPath)).arrayBuffer());
  } catch (err) {
    throw new TranscriptionProviderError(
      `לא הצלחתי לקרוא את קובץ השמע: ${err instanceof Error ? err.message : String(err)}`,
      "transcription_failed",
      "local-whisper",
      err,
    );
  }
  const duration = samples.length / 16_000;
  try {
    const { chunks } = await transcribeSamples(samples);
    return chunksToResult(chunks, duration);
  } catch (err) {
    throw new TranscriptionProviderError(
      err instanceof Error ? err.message : String(err),
      "transcription_failed",
      "local-whisper",
      err,
    );
  }
}

/** Whisper chunks → the app's segments (an open last end means "to the end"). */
export function chunksToResult(chunks: AsrChunk[], duration: number): TranscriptionResult {
  const segments: WhisperSegment[] = chunks
    .map((c) => ({
      start: c.timestamp[0] ?? 0,
      end: c.timestamp[1] ?? duration,
      text: fixTranscript((c.text ?? "").trim()),
    }))
    .filter((s) => s.text.length > 0)
    .map((s, i) => ({ idx: i, start: round3(s.start), end: round3(Math.min(s.end, duration)), text: s.text }));
  return {
    text: fixTranscript(segments.map((s) => s.text).join(" ")),
    segments,
    duration: round3(duration),
    transcription_model: MODEL_ID,
    billed_audio_sec: 0,
  };
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
