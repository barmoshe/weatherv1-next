// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPickSegmentsDetailed = vi.fn();
const mockPickWithShortlists = vi.fn();
const mockRetrieveCandidates = vi.fn();
const mockValidateAndSwap = vi.fn();
const mockUpdatePlanBundle = vi.fn();
const mockReadPlanBundle = vi.fn();
const mockRecordJobFailure = vi.fn();
const mockRecordPickerFailure = vi.fn();
const mockPersistPlanUsage = vi.fn();
const mockPersistReplanPickerUsage = vi.fn();
const mockApplyCoverageSplit = vi.fn();

const SCENE = {
  idx: 0,
  start_sec: 0,
  end_sec: 8,
  title_he: "שרב",
  narration: "שרב ועומס חום",
  keywords: ["שרב"],
  kind: "prose",
  heterogeneous: false,
  whisper_beat_indices: [],
};

vi.mock("@/server/runtime/auth", () => ({ assertDesktopAuth: vi.fn(() => null) }));
vi.mock("@/server/catalog/storage", () => ({ readCatalog: vi.fn(() => ({ videos: [] })) }));
vi.mock("@/server/catalog/parser", () => ({
  parseCatalog: vi.fn(() => []),
  buildSegmentMap: vi.fn(() => ({})),
  buildVideoMap: vi.fn(() => ({})),
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  updatePlanBundle: mockUpdatePlanBundle,
  readPlanBundle: (...a: unknown[]) => mockReadPlanBundle(...a),
}));
vi.mock("@/server/providers/errors", () => ({ mapProviderError: vi.fn(() => null) }));
vi.mock("@/server/jobs/failure", () => ({
  recordJobFailure: (...a: unknown[]) => mockRecordJobFailure(...a),
  recordPickerFailure: (...a: unknown[]) => mockRecordPickerFailure(...a),
}));
vi.mock("@/server/jobs/usage-persist", () => ({
  persistPlanUsage: (...a: unknown[]) => mockPersistPlanUsage(...a),
  persistReplanPickerUsage: (...a: unknown[]) => mockPersistReplanPickerUsage(...a),
}));
vi.mock("@/server/pipeline/retrieve", () => ({
  retrieveCandidates: (...a: unknown[]) => mockRetrieveCandidates(...a),
}));
vi.mock("@/server/pipeline/coverage", () => ({
  applyCoverageSplit: (...a: unknown[]) => mockApplyCoverageSplit(...a),
}));
vi.mock("@/server/pipeline/scene-planner", () => ({
  planScenes: vi.fn(async () => ({ scenes: [SCENE] })),
  planScenesVer2: vi.fn(async () => ({ scenes: [SCENE] })),
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
    pickWithShortlists: mockPickWithShortlists,
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

const EMPTY_PICKER_STATUS = {
  state: "empty",
  provider: "anthropic",
  catalog_rows: 408,
  scenes_requested: 1,
  payload_bytes: 400000,
  usable_picks: 0,
  error_code: "picker_empty",
};

beforeEach(() => {
  mockPickSegmentsDetailed.mockReset();
  mockPickWithShortlists.mockReset();
  mockRetrieveCandidates.mockReset();
  mockValidateAndSwap.mockReset();
  mockUpdatePlanBundle.mockReset();
  mockReadPlanBundle.mockReset();
  mockReadPlanBundle.mockReturnValue({}); // no checkpointed scenes by default
  mockRecordJobFailure.mockReset();
  mockRecordPickerFailure.mockReset();
  mockPersistPlanUsage.mockReset();
  mockPersistReplanPickerUsage.mockReset();
  mockApplyCoverageSplit.mockReset();
  delete process.env.PLAN_PIPELINE_VER2;
});

describe("/api/plan ver1 (opt-out)", () => {
  beforeEach(() => {
    process.env.PLAN_PIPELINE_VER2 = "0";
  });

  it("fails loudly when the picker returns zero usable picks", async () => {
    mockPickSegmentsDetailed.mockResolvedValueOnce({
      timeline: [],
      picker_status: EMPTY_PICKER_STATUS,
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
    // Scenes are checkpointed before the picker, but the misleading (empty)
    // timeline is never persisted.
    expect(mockUpdatePlanBundle).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ scene_planner_done: true }),
    );
    expect(mockUpdatePlanBundle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeline: expect.anything() }),
    );
  });

  it("reuses checkpointed scenes on replan without re-running the scene planner", async () => {
    const planner = await import("@/server/pipeline/scene-planner");
    vi.mocked(planner.planScenes).mockClear(); // shared mock accumulates across tests
    mockReadPlanBundle.mockReturnValue({ scene_planner_done: true, scenes: [SCENE] });
    mockPickSegmentsDetailed.mockResolvedValueOnce({
      timeline: [{ video_id: "v1", segment_id: "s1" }],
      picker_status: { state: "ok" },
    });
    mockValidateAndSwap.mockReturnValue(undefined);
    const { POST } = await import("@/app/api/plan/route");

    await POST(request() as never);

    expect(planner.planScenes).not.toHaveBeenCalled();
    // Picker-only billing on a resume; scene usage was billed on the first run.
    expect(mockPersistReplanPickerUsage).toHaveBeenCalled();
  });
});

describe("/api/plan ver2 (default since v0.4.0)", () => {
  it("routes to the retrieve-then-pick pipeline by default", async () => {
    mockRetrieveCandidates.mockReturnValue({ shortlist: [], shortlist_thin: false });
    mockPickWithShortlists.mockResolvedValueOnce({
      timeline: [],
      picker_status: EMPTY_PICKER_STATUS,
    });
    const { POST } = await import("@/app/api/plan/route");

    await POST(request() as never);

    expect(mockPickWithShortlists).toHaveBeenCalled();
    expect(mockPickSegmentsDetailed).not.toHaveBeenCalled();
  });

  it("fails loudly when the ver2 picker returns an empty timeline", async () => {
    mockRetrieveCandidates.mockReturnValue({ shortlist: [], shortlist_thin: false });
    mockPickWithShortlists.mockResolvedValueOnce({
      timeline: [],
      picker_status: EMPTY_PICKER_STATUS,
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
    expect(mockRecordPickerFailure).toHaveBeenCalledWith(
      "job-1",
      EMPTY_PICKER_STATUS,
      "בחירת הקליפים נכשלה.",
    );
    // Scenes checkpointed before the picker; the empty timeline is not persisted.
    expect(mockUpdatePlanBundle).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ scene_planner_done: true }),
    );
    expect(mockUpdatePlanBundle).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ timeline: expect.anything() }),
    );
  });

  it("checkpoints scenes before the picker runs (survives a picker throw)", async () => {
    mockRetrieveCandidates.mockReturnValue({ shortlist: [], shortlist_thin: false });
    mockPickWithShortlists.mockRejectedValueOnce(new Error("picker boom"));
    const { POST } = await import("@/app/api/plan/route");

    await POST(request() as never);

    expect(mockUpdatePlanBundle).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({ scene_planner_done: true }),
    );
  });

  it("falls back to ver1 when PLAN_PIPELINE_VER2=0", async () => {
    process.env.PLAN_PIPELINE_VER2 = "0";
    mockPickSegmentsDetailed.mockResolvedValueOnce({
      timeline: [],
      picker_status: EMPTY_PICKER_STATUS,
    });
    const { POST } = await import("@/app/api/plan/route");

    await POST(request() as never);

    expect(mockPickSegmentsDetailed).toHaveBeenCalled();
    expect(mockPickWithShortlists).not.toHaveBeenCalled();
  });
});
