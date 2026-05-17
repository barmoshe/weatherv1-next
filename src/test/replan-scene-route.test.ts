// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDesktopAuth: vi.fn(),
  readCatalog: vi.fn(),
  parseCatalog: vi.fn(),
  buildSegmentMap: vi.fn(),
  buildVideoMap: vi.fn(),
  validateAndSwap: vi.fn(),
  updatePlanBundle: vi.fn(),
  persistReplanPickerUsage: vi.fn(),
  mapProviderError: vi.fn(),
  pickSegmentsDetailed: vi.fn(),
}));

vi.mock("@/server/runtime/auth", () => ({
  assertDesktopAuth: (req: unknown) => mocks.assertDesktopAuth(req),
}));
vi.mock("@/server/catalog/storage", () => ({
  readCatalog: mocks.readCatalog,
}));
vi.mock("@/server/catalog/parser", () => ({
  parseCatalog: mocks.parseCatalog,
  buildSegmentMap: mocks.buildSegmentMap,
  buildVideoMap: mocks.buildVideoMap,
}));
vi.mock("@/server/pipeline/validator", () => ({
  validateAndSwap: mocks.validateAndSwap,
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  updatePlanBundle: mocks.updatePlanBundle,
}));
vi.mock("@/server/jobs/usage-persist", () => ({
  persistReplanPickerUsage: mocks.persistReplanPickerUsage,
}));
vi.mock("@/server/providers/errors", () => ({
  mapProviderError: mocks.mapProviderError,
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
    pickSegmentsDetailed: mocks.pickSegmentsDetailed,
    PickerFailureError,
  };
});

const validBody = () => ({
  job_id: "job-1",
  scenes: [{ idx: 0, start_sec: 0, end_sec: 8 }],
  timeline: [{ scene_idx: 0, segment_id: "old", audio_start: 0, audio_end: 8 }],
  scene_idx: 0,
});

function req(body: unknown) {
  return new Request("http://localhost/api/replan_scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertDesktopAuth.mockReturnValue(null);
  mocks.readCatalog.mockReturnValue({ videos: [], updated_at: "x" });
  mocks.parseCatalog.mockReturnValue([]);
  mocks.buildSegmentMap.mockReturnValue({});
  mocks.buildVideoMap.mockReturnValue({});
  mocks.validateAndSwap.mockReturnValue({ ok: true });
  mocks.updatePlanBundle.mockResolvedValue(undefined);
  mocks.mapProviderError.mockReturnValue(null);
});

describe("/api/replan_scene", () => {
  it("returns 401 when auth denies", async () => {
    const { NextResponse } = await import("next/server");
    mocks.assertDesktopAuth.mockReturnValueOnce(
      NextResponse.json({ success: false }, { status: 401 }),
    );
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(401);
    expect(mocks.pickSegmentsDetailed).not.toHaveBeenCalled();
  });

  it("returns 400 when scene_idx is missing", async () => {
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req({ ...validBody(), scene_idx: undefined }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/scene_idx/);
  });

  it("returns 400 when scenes is empty", async () => {
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req({ ...validBody(), scenes: [] }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when job_id is missing", async () => {
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req({ ...validBody(), job_id: undefined }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when scene_idx does not match any scene", async () => {
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req({ ...validBody(), scene_idx: 7 }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown scene_idx/);
  });

  it("returns 400 when per-pick pick_index is out of range", async () => {
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req({ ...validBody(), pick_index: 5 }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Pick index 5/);
  });

  it("returns 422 when the picker returns an empty timeline", async () => {
    mocks.pickSegmentsDetailed.mockResolvedValueOnce({
      timeline: [],
      picker_status: { state: "empty", error_code: "picker_empty" as const },
      picker_usages: [],
    });
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body).toMatchObject({
      success: false,
      error_code: "picker_empty",
      picker_status: { state: "empty" },
    });
    expect(mocks.updatePlanBundle).not.toHaveBeenCalled();
  });

  it("returns 502 when the picker throws PickerFailureError", async () => {
    const { PickerFailureError } = await import("@/server/pipeline/picker");
    mocks.pickSegmentsDetailed.mockRejectedValueOnce(
      new PickerFailureError("picker dead", {
        state: "failed",
        catalog_rows: 0,
        scenes_requested: 1,
        payload_bytes: 0,
        usable_picks: 0,
      }),
    );
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.picker_status.state).toBe("failed");
  });

  it("returns 200 on success and persists usage", async () => {
    mocks.pickSegmentsDetailed.mockResolvedValueOnce({
      timeline: [
        { segment_id: "new-s0", video_id: "new", audio_start: 0, audio_end: 8, reason: "match" },
      ],
      picker_status: { state: "ok" },
      picker_usages: [{ step: "replan_picker_attempt_1", input_tokens: 100, output_tokens: 50 }],
    });
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.timeline[0].segment_id).toBe("new-s0");

    expect(mocks.updatePlanBundle).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        timeline: expect.any(Array),
        validator: { ok: true },
        picker_status: { state: "ok" },
      }),
    );
    expect(mocks.persistReplanPickerUsage).toHaveBeenCalledWith(
      "job-1",
      expect.arrayContaining([
        expect.objectContaining({ step: "replan_picker_attempt_1" }),
      ]),
    );
  });

  it("returns 500 on unexpected errors", async () => {
    mocks.pickSegmentsDetailed.mockRejectedValueOnce(new Error("network"));
    const { POST } = await import("@/app/api/replan_scene/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(500);
  });
});
