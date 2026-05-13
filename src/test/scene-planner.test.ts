// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fallbackSingleScene, planScenes } from "@/server/pipeline/scene-planner";
import type { WhisperSegment } from "@/shared/types";

// Mock the LLM provider boundary, not the raw OpenAI client. The pipeline now
// asks `getLlmProvider().completeJson()` for structured JSON; tests only need
// to control what that returns.
vi.mock("@/server/providers/llm", async () => {
  const mockCompleteJson = vi.fn();
  return {
    getLlmProvider: vi.fn(() => ({
      id: "anthropic",
      completeJson: mockCompleteJson,
    })),
    LlmProviderError: class extends Error {
      constructor(
        message: string,
        public readonly code: string,
        public readonly provider: string,
      ) {
        super(message);
      }
    },
    mockCompleteJson,
  };
});

async function getMockCompleteJson() {
  const mod = await import("@/server/providers/llm");
  return (mod as unknown as { mockCompleteJson: ReturnType<typeof vi.fn> })
    .mockCompleteJson;
}

function segs(n: number, step = 3.0): WhisperSegment[] {
  return Array.from({ length: n }, (_, i) => ({
    idx: i,
    start: i * step,
    end: (i + 1) * step,
    text: `s${i}`,
  }));
}

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test-key";
});

// ---------------------------------------------------------------------------
// fallbackSingleScene
// ---------------------------------------------------------------------------

describe("fallbackSingleScene", () => {
  it("covers full audio duration as a single prose scene", () => {
    const whisper: WhisperSegment[] = [{ idx: 0, start: 0, end: 5, text: "שלום" }];
    const out = fallbackSingleScene("שלום עולם", whisper, 10);
    expect(out).toHaveLength(1);
    expect(out[0].start_sec).toBe(0);
    expect(out[0].end_sec).toBe(10);
    expect(out[0].kind).toBe("prose");
    expect(out[0].whisper_beat_indices).toContain(0);
  });

  it("returns empty array when duration is 0", () => {
    expect(fallbackSingleScene("text", [], 0)).toHaveLength(0);
  });

  it("sets narration from transcript when no whisper segs", () => {
    const out = fallbackSingleScene("hello world", [], 5);
    expect(out).toHaveLength(1);
    expect(out[0].narration).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// planScenes — post-processing via mocked LlmProvider response
// ---------------------------------------------------------------------------

describe("planScenes", () => {
  it("snaps scene boundaries to Whisper segment ends", async () => {
    const mockCompleteJson = await getMockCompleteJson();
    const whisper = segs(4, 3.0); // boundaries: 0, 3, 6, 9, 12
    const rawScenes = [
      { start_sec: 0.0, end_sec: 3.2, title_he: "א", kind: "prose" },
      { start_sec: 3.2, end_sec: 5.9, title_he: "ב", kind: "prose" },
      { start_sec: 5.9, end_sec: 12.0, title_he: "ג", kind: "prose" },
    ];
    mockCompleteJson.mockResolvedValueOnce({ scenes: rawScenes });

    const out = await planScenes("transcript", whisper, 12.0);
    const validBoundaries = new Set([0, 3, 6, 9, 12]);
    for (const s of out) {
      expect(validBoundaries.has(s.start_sec)).toBe(true);
      expect(validBoundaries.has(s.end_sec)).toBe(true);
    }
  });

  it("merges sub-minimum scenes (< 3s) into neighbors", async () => {
    const mockCompleteJson = await getMockCompleteJson();
    const whisper = segs(5, 2.0);
    const rawScenes = [
      { start_sec: 0.0, end_sec: 2.0, title_he: "short", kind: "prose" },
      { start_sec: 2.0, end_sec: 6.0, title_he: "med", kind: "prose" },
      { start_sec: 6.0, end_sec: 10.0, title_he: "end", kind: "prose" },
    ];
    mockCompleteJson.mockResolvedValueOnce({ scenes: rawScenes });

    const out = await planScenes("transcript", whisper, 10.0);
    for (const s of out) {
      expect(s.end_sec - s.start_sec).toBeGreaterThanOrEqual(3.0);
    }
    expect(out[0].start_sec).toBe(0.0);
  });

  it("coerces homogeneous multi-region list scenes to heterogeneous", async () => {
    const mockCompleteJson = await getMockCompleteJson();
    const whisper = segs(4, 3.0);
    const rawScenes = [
      {
        start_sec: 0.0,
        end_sec: 12.0,
        title_he: "multi",
        kind: "list",
        heterogeneous: false,
        narration: "מעונן וטפטוף בצפון ובמרכז.",
      },
    ];
    mockCompleteJson.mockResolvedValueOnce({ scenes: rawScenes });

    const out = await planScenes("transcript", whisper, 12.0);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("list");
    expect(out[0].heterogeneous).toBe(true);
  });

  it("preserves heterogeneous flag through post-processing", async () => {
    const mockCompleteJson = await getMockCompleteJson();
    const whisper = segs(4, 3.0);
    const rawScenes = [
      { start_sec: 0.0, end_sec: 6.0, title_he: "multi-region", kind: "list", heterogeneous: true },
      { start_sec: 6.0, end_sec: 12.0, title_he: "rest", kind: "prose" },
    ];
    mockCompleteJson.mockResolvedValueOnce({ scenes: rawScenes });

    const out = await planScenes("transcript", whisper, 12.0);
    expect(out[0].heterogeneous).toBe(true);
    expect(out[1].heterogeneous).toBe(false);
  });

  it("returns empty array when LLM response has no scenes", async () => {
    const mockCompleteJson = await getMockCompleteJson();
    mockCompleteJson.mockResolvedValueOnce({ scenes: [] });
    const out = await planScenes("transcript", segs(3), 9.0);
    expect(out).toHaveLength(0);
  });

  it("assigns sequential idx values starting at 0", async () => {
    const mockCompleteJson = await getMockCompleteJson();
    const whisper = segs(4, 3.0);
    const rawScenes = [
      { start_sec: 0.0, end_sec: 6.0, title_he: "א", kind: "prose" },
      { start_sec: 6.0, end_sec: 12.0, title_he: "ב", kind: "prose" },
    ];
    mockCompleteJson.mockResolvedValueOnce({ scenes: rawScenes });

    const out = await planScenes("transcript", whisper, 12.0);
    out.forEach((s, i) => expect(s.idx).toBe(i));
  });
});
