// @vitest-environment node
import { describe, expect, it } from "vitest";
import { __internal } from "@/server/providers/transcription/whispercpp-local";

const { parseTimestamp, parseWhisperCppJson } = __internal;

describe("whisper.cpp output parsing", () => {
  it("parses HH:MM:SS.mmm timestamps", () => {
    expect(parseTimestamp("00:00:01.500")).toBeCloseTo(1.5, 3);
    expect(parseTimestamp("01:02:03.040")).toBeCloseTo(3723.04, 2);
    expect(parseTimestamp(undefined)).toBe(0);
    expect(parseTimestamp("garbage")).toBe(0);
  });

  it("converts whisper.cpp JSON sidecar to WhisperSegments", () => {
    const sidecar = JSON.stringify({
      result: { language: "he" },
      transcription: [
        {
          timestamps: { from: "00:00:00.000", to: "00:00:02.500" },
          offsets: { from: 0, to: 2500 },
          text: " שלום ",
        },
        {
          timestamps: { from: "00:00:02.500", to: "00:00:05.000" },
          offsets: { from: 2500, to: 5000 },
          text: "עולם",
        },
      ],
    });

    const out = parseWhisperCppJson(sidecar);
    expect(out.segments).toHaveLength(2);
    expect(out.segments[0]).toMatchObject({ idx: 0, start: 0, end: 2.5, text: "שלום" });
    expect(out.segments[1]).toMatchObject({ idx: 1, start: 2.5, end: 5, text: "עולם" });
    expect(out.text).toBe("שלום עולם");
    expect(out.duration).toBe(5);
  });

  it("falls back to timestamps when offsets are missing", () => {
    const sidecar = JSON.stringify({
      transcription: [
        {
          timestamps: { from: "00:00:01.000", to: "00:00:04.000" },
          text: "test",
        },
      ],
    });
    const out = parseWhisperCppJson(sidecar);
    expect(out.segments[0].start).toBe(1);
    expect(out.segments[0].end).toBe(4);
  });
});
