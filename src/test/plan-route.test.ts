// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPickSegmentsDetailed = vi.fn();
const mockValidateAndSwap = vi.fn();
const mockUpdatePlanBundle = vi.fn();

vi.mock("@/server/runtime/auth", () => ({ assertDesktopAuth: vi.fn(() => null) }));
vi.mock("@/server/catalog/storage", () => ({ readCatalog: vi.fn(() => ({ videos: [] })) }));
vi.mock("@/server/catalog/parser", () => ({
  parseCatalog: vi.fn(() => []),
  buildSegmentMap: vi.fn(() => ({})),
  buildVideoMap: vi.fn(() => ({})),
}));
vi.mock("@/server/jobs/plan-bundle", () => ({ updatePlanBundle: mockUpdatePlanBundle }));
vi.mock("@/server/providers/errors", () => ({ mapProviderError: vi.fn(() => null) }));
vi.mock("@/server/pipeline/scene-planner", () => ({
  planScenes: vi.fn(async () => ({
    scenes: [
      {
        idx: 0,
        start_sec: 0,
        end_sec: 8,
        title_he: "שרב",
        narration: "שרב ועומס חום",
        keywords: ["שרב"],
        kind: "prose",
        heterogeneous: false,
        whisper_beat_indices: [],
      },
    ],
  })),
  fallbackSingleScene: vi.fn(() => []),
}));
vi.mock("@/server/pipeline/picker", () => {
  class PickerFailureError extends Error {
    constructor(
      message: string,
      public readonly picker_status: unknown,
    ) {
      super(message);
      this.name = "PickerFailureError";
    }
  }
  return {
    pickSegmentsDetailed: mockPickSegmentsDetailed,
    PickerFailureError,
  };
});
vi.mock("@/server/pipeline/validator", () => ({
  validateAndSwap: mockValidateAndSwap,
}));

function request() {
  return new Request("http://localhost/api/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      job_id: "job-1",
      transcript: "שרב ועומס חום",
      duration: 8,
      transcript_segments: [{ start: 0, end: 8, text: "שרב ועומס חום" }],
    }),
  });
}

beforeEach(() => {
  mockPickSegmentsDetailed.mockReset();
  mockValidateAndSwap.mockReset();
  mockUpdatePlanBundle.mockReset();
});

describe("/api/plan", () => {
  it("fails loudly when the picker returns zero usable picks", async () => {
    mockPickSegmentsDetailed.mockResolvedValueOnce({
      timeline: [],
      picker_status: {
        state: "empty",
        provider: "anthropic",
        catalog_rows: 408,
        scenes_requested: 1,
        payload_bytes: 400000,
        usable_picks: 0,
        error_code: "picker_empty",
      },
    });
    const { POST } = await import("@/app/api/plan/route");

    const res = await POST(request() as never);
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body).toMatchObject({
      success: false,
      error_code: "picker_empty",
      picker_status: { state: "empty", usable_picks: 0 },
    });
    expect(mockValidateAndSwap).not.toHaveBeenCalled();
    expect(mockUpdatePlanBundle).not.toHaveBeenCalled();
  });
});
