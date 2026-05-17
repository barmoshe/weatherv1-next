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
  mapProviderError: vi.fn(),
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
vi.mock("@/server/providers/errors", () => ({
  mapProviderError: mocks.mapProviderError,
}));

const validBody = () => ({
  job_id: "job-1",
  scenes: [{ idx: 0, start_sec: 0, end_sec: 8 }],
  timeline: [
    { scene_idx: 0, segment_id: "vid-old-s0", audio_start: 0, audio_end: 8 },
  ],
  scene_idx: 0,
  pick_index: 0,
  new_segment_id: "vid-new-s0",
});

function req(body: unknown) {
  return new Request("http://localhost/api/pick_segment", {
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
  mocks.buildSegmentMap.mockReturnValue({
    "vid-new-s0": {
      clip: { id: "vid-new" },
      segment: { id: "vid-new-s0", start_sec: 2, end_sec: 10 },
    },
  });
  mocks.buildVideoMap.mockReturnValue({});
  mocks.validateAndSwap.mockReturnValue({ ok: true });
  mocks.updatePlanBundle.mockResolvedValue(undefined);
  mocks.mapProviderError.mockReturnValue(null);
});

describe("/api/pick_segment", () => {
  it("returns 401 when auth denies", async () => {
    const { NextResponse } = await import("next/server");
    mocks.assertDesktopAuth.mockReturnValueOnce(
      NextResponse.json({ success: false }, { status: 401 }),
    );
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(401);
    expect(mocks.updatePlanBundle).not.toHaveBeenCalled();
  });

  it("returns 400 when job_id is missing", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const body = { ...validBody(), job_id: undefined };
    const res = await POST(req(body) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/job_id/);
  });

  it("returns 400 when scenes is empty", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req({ ...validBody(), scenes: [] }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/scenes/);
  });

  it("returns 400 when scene_idx is missing", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req({ ...validBody(), scene_idx: undefined }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when pick_index is missing", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req({ ...validBody(), pick_index: undefined }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when new_segment_id is missing", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req({ ...validBody(), new_segment_id: undefined }) as never);
    expect(res.status).toBe(400);
  });

  it("returns 400 when scene_idx is unknown", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req({ ...validBody(), scene_idx: 99 }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown scene_idx/);
  });

  it("returns 400 when new_segment_id is not in segmentMap", async () => {
    mocks.buildSegmentMap.mockReturnValueOnce({});
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Unknown segment/);
  });

  it("returns 400 when pick_index is out of range for the scene", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req({ ...validBody(), pick_index: 5 }) as never);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Pick index 5 not found/);
  });

  it("returns 200 with swapped timeline on success and persists the plan bundle", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.scene_idx).toBe(0);
    expect(body.timeline[0].segment_id).toBe("vid-new-s0");
    expect(body.timeline[0].video_id).toBe("vid-new");
    expect(body.validator).toEqual({ ok: true });

    expect(mocks.updatePlanBundle).toHaveBeenCalledWith(
      "job-1",
      expect.objectContaining({
        timeline: expect.any(Array),
        validator: { ok: true },
      }),
    );
  });

  it("returns 500 on unexpected errors", async () => {
    mocks.validateAndSwap.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(req(validBody()) as never);
    expect(res.status).toBe(500);
  });
});
