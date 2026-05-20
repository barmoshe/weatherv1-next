import { describe, it, expect } from "vitest";
import { formatSrtTimestamp, segmentsToSrt, srtFileBuffer, UTF8_BOM } from "@/server/export/srt";
import type { WhisperSegment } from "@/shared/types";

const segs: WhisperSegment[] = [
  { idx: 0, start: 0, end: 6, text: "בוקר נעים" },
  { idx: 1, start: 6, end: 11.5, text: "בצפון רוחות" },
];

describe("formatSrtTimestamp", () => {
  it("formats HH:MM:SS,mmm", () => {
    expect(formatSrtTimestamp(0)).toBe("00:00:00,000");
    expect(formatSrtTimestamp(6)).toBe("00:00:06,000");
    expect(formatSrtTimestamp(11.5)).toBe("00:00:11,500");
    expect(formatSrtTimestamp(3661.25)).toBe("01:01:01,250");
  });

  it("clamps negative input to zero", () => {
    expect(formatSrtTimestamp(-5)).toBe("00:00:00,000");
  });
});

describe("segmentsToSrt", () => {
  it("emits 1-based cues with arrow timestamps and trimmed text", () => {
    const srt = segmentsToSrt(segs);
    expect(srt).toContain("1\n00:00:00,000 --> 00:00:06,000\nבוקר נעים");
    expect(srt).toContain("2\n00:00:06,000 --> 00:00:11,500\nבצפון רוחות");
  });
});

describe("srtFileBuffer", () => {
  it("prepends a UTF-8 BOM (EF BB BF)", () => {
    const buf = srtFileBuffer(segs);
    expect([buf[0], buf[1], buf[2]]).toEqual([0xef, 0xbb, 0xbf]);
  });

  it("round-trips Hebrew text after the BOM", () => {
    const decoded = srtFileBuffer(segs).toString("utf8");
    expect(decoded.startsWith(UTF8_BOM)).toBe(true);
    expect(decoded).toContain("בוקר נעים");
  });
});
