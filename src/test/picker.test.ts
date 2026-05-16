// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { pickSegmentsDetailed, prepareCatalog } from "@/server/pipeline/picker";
import type { ParsedVideo } from "@/shared/types";

vi.mock("@/server/providers/llm", async () => {
  const mockCompleteJson = vi.fn();
  class LlmProviderError extends Error {
    constructor(
      message: string,
      public readonly code: string,
      public readonly provider: string,
    ) {
      super(message);
      this.name = "LlmProviderError";
    }
  }
  return {
    getLlmProvider: vi.fn(() => ({
      id: "anthropic",
      model: "test-model",
      completeJson: mockCompleteJson,
    })),
    LlmProviderError,
    mockCompleteJson,
  };
});

async function mocks() {
  return await import("@/server/providers/llm") as unknown as {
    mockCompleteJson: ReturnType<typeof vi.fn>;
    LlmProviderError: new (message: string, code: string, provider: string) => Error;
  };
}

/** Shape returned by real `completeJson`; tests mock this. */
function mockPickTimeline(timeline: Array<Record<string, unknown>>) {
  return {
    data: { timeline },
    usage: {
      provider: "anthropic" as const,
      model: "test-model",
      input_tokens: 200,
      output_tokens: 100,
    },
  };
}

function video(): ParsedVideo {
  return {
    id: "IB001",
    filename: "ib001.mp4",
    description: "",
    path: "/tmp/ib001.mp4",
    availability: "local",
    duration_sec: 12,
    orientation: "V",
    source: "original",
    tags: { main: "", secondary: "", third: "" },
    segments: [
      {
        id: "IB001-s0",
        start_sec: 0,
        end_sec: 12,
        description: "שמש חזקה מעל נוף יבש",
        tags: ["שמש", "חם", "יום"],
        concepts: {
          weather: ["חם", "בהיר"],
          season_mood: ["קיצי"],
          visual_role: ["עומס חום"],
          scene_fit: ["שרב"],
          avoid_for: [],
        },
      },
    ],
  };
}

beforeEach(async () => {
  const { mockCompleteJson } = await mocks();
  mockCompleteJson.mockReset();
});

describe("picker", () => {
  it("keeps the full catalog compact by omitting duplicated concept_terms", () => {
    const rows = prepareCatalog([video()]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      segment_id: "IB001-s0",
      clip_id: "IB001",
      tags: ["שמש", "חם", "יום"],
    });
    expect(rows[0]).not.toHaveProperty("concept_terms");
  });

  it("returns an empty status instead of pretending the picker succeeded", async () => {
    const { mockCompleteJson } = await mocks();
    mockCompleteJson.mockResolvedValueOnce(mockPickTimeline([]));

    const result = await pickSegmentsDetailed("תחזית", [video()], 12, {
      scenes: [{
        idx: 0,
        start_sec: 0,
        end_sec: 12,
        title_he: "שרב",
        narration: "שרב ועומס חום",
        keywords: ["שרב"],
        kind: "prose",
        heterogeneous: false,
        whisper_beat_indices: [],
      }],
    });

    expect(result.timeline).toHaveLength(0);
    expect(result.picker_status).toMatchObject({
      state: "empty",
      provider: "anthropic",
      model: "test-model",
      catalog_rows: 1,
      scenes_requested: 1,
      usable_picks: 0,
      error_code: "picker_empty",
    });
    expect(result.picker_status.payload_bytes).toBeGreaterThan(0);
  });

  it("throws structured picker failure for schema/provider failures", async () => {
    const { mockCompleteJson, LlmProviderError } = await mocks();
    mockCompleteJson.mockRejectedValueOnce(
      new LlmProviderError("bad structured response", "llm_invalid_response", "anthropic"),
    );

    await expect(
      pickSegmentsDetailed("תחזית", [video()], 12, {
        scenes: [{
          idx: 0,
          start_sec: 0,
          end_sec: 12,
          title_he: "שרב",
          narration: "שרב ועומס חום",
          keywords: ["שרב"],
          kind: "prose",
          heterogeneous: false,
          whisper_beat_indices: [],
        }],
      }),
    ).rejects.toMatchObject({
      name: "PickerFailureError",
      picker_status: {
        state: "failed",
        error_code: "llm_invalid_response",
        usable_picks: 0,
      },
    });
  });

  const scenePatch = {
    idx: 0,
    start_sec: 0,
    end_sec: 12,
    title_he: "שרב",
    narration: "שרב ועומס חום",
    keywords: ["שרב"],
    kind: "prose" as const,
    heterogeneous: false,
    whisper_beat_indices: [] as number[],
  };

  it("retries empty timelines up to maxLlmAttempts", async () => {
    const { mockCompleteJson } = await mocks();
    mockCompleteJson
      .mockResolvedValueOnce(mockPickTimeline([]))
      .mockResolvedValueOnce(mockPickTimeline([]))
      .mockResolvedValueOnce(
        mockPickTimeline([
          {
            scene_idx: 0,
            segment_id: "IB001-s0",
            audio_start: 0,
            audio_end: 12,
            reason: "ok",
          },
        ]),
      );

    const result = await pickSegmentsDetailed("תחזית", [video()], 12, {
      maxLlmAttempts: 3,
      scenes: [scenePatch],
    });

    expect(mockCompleteJson).toHaveBeenCalledTimes(3);
    expect(result.timeline).toHaveLength(1);
    expect(result.picker_status.llm_attempts_used).toBe(3);
    expect(result.picker_usages?.map((u) => u.step)).toEqual(["picker_attempt_1", "picker_attempt_2", "picker_attempt_3"]);
    expect(result.picker_usages).toHaveLength(3);
  });

  it("stops after three empty timelines without a fourth LLM call", async () => {
    const { mockCompleteJson } = await mocks();
    mockCompleteJson.mockResolvedValue(mockPickTimeline([]));

    const result = await pickSegmentsDetailed("תחזית", [video()], 12, {
      maxLlmAttempts: 3,
      scenes: [scenePatch],
    });

    expect(mockCompleteJson).toHaveBeenCalledTimes(3);
    expect(result.timeline).toHaveLength(0);
    expect(result.picker_status.last_retry_reason).toBe("exhausted_llm_attempts_empty_timeline");
    expect(result.picker_usages).toHaveLength(3);
  });

  it("keeps systemPrompt byte-identical across retries (prefix-cache friendly)", async () => {
    const { mockCompleteJson } = await mocks();
    mockCompleteJson
      .mockResolvedValueOnce(mockPickTimeline([]))
      .mockResolvedValueOnce(mockPickTimeline([]))
      .mockResolvedValueOnce(
        mockPickTimeline([
          { scene_idx: 0, segment_id: "IB001-s0", audio_start: 0, audio_end: 12, reason: "ok" },
        ]),
      );

    await pickSegmentsDetailed("תחזית", [video()], 12, {
      maxLlmAttempts: 3,
      scenes: [scenePatch],
    });

    expect(mockCompleteJson).toHaveBeenCalledTimes(3);
    const sys1 = mockCompleteJson.mock.calls[0][0].systemPrompt;
    const sys2 = mockCompleteJson.mock.calls[1][0].systemPrompt;
    const sys3 = mockCompleteJson.mock.calls[2][0].systemPrompt;
    expect(sys2).toBe(sys1);
    expect(sys3).toBe(sys1);
    // Retry-mode notes belong in the user payload, not the system prompt.
    expect(sys1).not.toMatch(/RETRY MODE/);
  });

  it("filters avoidSegmentIds out of the catalog sent to the picker", async () => {
    const { mockCompleteJson } = await mocks();
    mockCompleteJson.mockResolvedValueOnce(
      mockPickTimeline([
        { scene_idx: 0, segment_id: "IB001-s0", audio_start: 0, audio_end: 12, reason: "ok" },
      ]),
    );

    await pickSegmentsDetailed("תחזית", [video()], 12, {
      scenes: [scenePatch],
      avoidSegmentIds: new Set(["IB001-s0"]),
    });

    expect(mockCompleteJson).toHaveBeenCalledTimes(1);
    const userPayload = JSON.parse(mockCompleteJson.mock.calls[0][0].userPayload);
    expect(userPayload.catalog).toEqual([]);
    expect(userPayload.avoid_segment_ids).toEqual(["IB001-s0"]);
  });
});
