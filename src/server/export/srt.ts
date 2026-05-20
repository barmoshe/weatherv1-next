/**
 * SRT caption serializer for the Premiere export bundle.
 *
 * Pure (no I/O) so it is trivially unit-testable. Emits UTF-8 *with* a BOM
 * because Premiere mis-decodes UTF-8 SRTs without a BOM for non-Latin scripts
 * (Hebrew, Arabic, Korean) — see docs/future/premiere/PLAN.md.
 */

import type { WhisperSegment } from "@/shared/types";

/** UTF-8 byte-order-mark. Encoded to disk as the bytes EF BB BF. */
export const UTF8_BOM = "﻿";

function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/** Seconds → `HH:MM:SS,mmm` (SRT timestamp form). */
export function formatSrtTimestamp(totalSec: number): string {
  const ms = Math.round(Math.max(0, totalSec) * 1000);
  const hours = Math.floor(ms / 3_600_000);
  const minutes = Math.floor((ms % 3_600_000) / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  const millis = ms % 1000;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)},${pad(millis, 3)}`;
}

/** Whisper segments → SRT body (no BOM). One cue per segment, 1-based index. */
export function segmentsToSrt(segments: WhisperSegment[]): string {
  return segments
    .map((seg, i) => {
      const start = formatSrtTimestamp(seg.start);
      const end = formatSrtTimestamp(seg.end);
      const text = (seg.text ?? "").trim();
      return `${i + 1}\n${start} --> ${end}\n${text}\n`;
    })
    .join("\n");
}

/** Whisper segments → a UTF-8-with-BOM Buffer ready to drop into the zip. */
export function srtFileBuffer(segments: WhisperSegment[]): Buffer {
  return Buffer.from(UTF8_BOM + segmentsToSrt(segments), "utf8");
}
