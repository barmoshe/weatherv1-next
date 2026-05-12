// @vitest-environment node
import { describe, it, expect } from "vitest";
import { mapAsrOutput } from "@/server/providers/transcription/whisper-onnx";

describe("whisper-onnx mapAsrOutput", () => {
  it("converts a transformers.js ASR output into ordered WhisperSegments", () => {
    const res = mapAsrOutput(
      {
        text: "שלום עולם זה מבחן",
        chunks: [
          { timestamp: [0, 1.5], text: " שלום עולם" },
          { timestamp: [1.5, 3.25], text: " זה מבחן" },
        ],
      },
      3.25,
    );

    expect(res.segments).toHaveLength(2);
    expect(res.segments[0]).toMatchObject({ idx: 0, start: 0, end: 1.5, text: "שלום עולם" });
    expect(res.segments[1]).toMatchObject({ idx: 1, start: 1.5, end: 3.25, text: "זה מבחן" });
    expect(res.text).toBe("שלום עולם זה מבחן");
    expect(res.duration).toBe(3.25);
  });

  it("falls back to total duration when the last chunk has no end timestamp", () => {
    const res = mapAsrOutput(
      {
        text: "",
        chunks: [{ timestamp: [0.0, null], text: " hi" }],
      },
      4.2,
    );

    expect(res.segments).toEqual([{ idx: 0, start: 0, end: 4.2, text: "hi" }]);
    expect(res.duration).toBe(4.2);
  });

  it("skips empty-text chunks but renumbers idx so consumers get a dense list", () => {
    const res = mapAsrOutput(
      {
        chunks: [
          { timestamp: [0, 1], text: " hello" },
          { timestamp: [1, 1.2], text: "  " },
          { timestamp: [1.2, 2.0], text: " world" },
        ],
      },
      2.0,
    );

    expect(res.segments.map((s) => s.idx)).toEqual([0, 1]);
    expect(res.segments.map((s) => s.text)).toEqual(["hello", "world"]);
  });

  it("clamps backwards timestamps that whisper-large-v3-turbo occasionally emits", () => {
    const res = mapAsrOutput(
      {
        chunks: [
          { timestamp: [0, 2.0], text: "א" },
          { timestamp: [1.5, 1.8], text: "ב" }, // overlaps the previous chunk
          { timestamp: [2.5, 2.4], text: "ג" }, // end < start
        ],
      },
      3.0,
    );

    expect(res.segments[1].start).toBeGreaterThanOrEqual(res.segments[0].end);
    expect(res.segments[2].end).toBeGreaterThanOrEqual(res.segments[2].start);
  });

  it("handles empty / missing chunks gracefully", () => {
    const res = mapAsrOutput({}, 1.0);
    expect(res.segments).toEqual([]);
    expect(res.duration).toBe(1);
    expect(res.text).toBe("");
  });
});
