// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPickSegmentsDetailed = vi.fn();
const mockPickWithShortlists = vi.fn();
const mockRetrieveCandidates = vi.fn();
const mockValidateAndSwap = vi.fn();
const mockUpdatePlanBundle = vi.fn();
const mockRecordJobFailure = vi.fn();
const mockRecordPickerFailure = vi.fn();
const mockPersistPlanUsage = vi.fn();
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
vi.mock("@/server/jobs/plan-bundle", () => ({ updatePlanBundle: mockUpdatePlanBundle }));
vi.mock("@/server/providers/errors", () => ({ mapProviderError: vi.fn(() => null) }));
vi.mock("@/server/jobs/failure", () => ({
  recordJobFailure: (...a: unknown[]) => mockRecordJobFailure(...a),
  recordPickerFailure: (...a: unknown[]) => mockRecordPickerFailure(...a),
}));
vi.mock("@/server/jobs/usage-persist", () => ({
  persistPlanUsage: (...a: unknown[]) => mockPersistPlanUsage(...a),
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
  mockRecordJobFailure.mockReset();
  mockRecordPickerFailure.mockReset();
  mockPersistPlanUsage.mockReset();
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
    expect(mockUpdatePlanBundle).not.toHaveBeenCalled();
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
    expect(mockUpdatePlanBundle).not.toHaveBeenCalled();
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
