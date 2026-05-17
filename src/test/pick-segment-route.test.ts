// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockValidateAndSwap = vi.fn();
const mockUpdatePlanBundle = vi.fn();
const mockReadCatalog = vi.fn(() => ({ videos: [] }));
const mockParseCatalog = vi.fn(() => []);
const mockBuildSegmentMap = vi.fn();
const mockBuildVideoMap = vi.fn(() => ({}));

vi.mock("@/server/runtime/auth", () => ({ assertDesktopAuth: vi.fn(() => null) }));
vi.mock("@/server/catalog/storage", () => ({ readCatalog: () => mockReadCatalog() }));
vi.mock("@/server/catalog/parser", () => ({
  parseCatalog: () => mockParseCatalog(),
  buildSegmentMap: () => mockBuildSegmentMap(),
  buildVideoMap: () => mockBuildVideoMap(),
}));
vi.mock("@/server/pipeline/validator", () => ({
  validateAndSwap: (...args: unknown[]) => mockValidateAndSwap(...args),
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  updatePlanBundle: (...args: unknown[]) => mockUpdatePlanBundle(...args),
}));
vi.mock("@/server/providers/errors", () => ({ mapProviderError: vi.fn(() => null) }));

const scene0 = { idx: 0, start_sec: 0, end_sec: 10 };
const scene1 = { idx: 1, start_sec: 10, end_sec: 20 };

function makeRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/pick_segment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/pick_segment route", () => {
  beforeEach(() => {
    mockValidateAndSwap.mockReset().mockReturnValue({ score: 100, swaps: { attempted: 0, succeeded: 0 } });
    mockUpdatePlanBundle.mockReset().mockResolvedValue({});
    mockBuildSegmentMap.mockReset().mockReturnValue({
      NEW123: { clip: { id: "V_NEW" }, segment: { start_sec: 0, end_sec: 8 } },
    });
  });

  it("SWAP: replaces the existing pick at scene-relative pick_index", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(
      makeRequest({
        job_id: "job-1",
        scenes: [scene0, scene1],
        timeline: [
          { scene_idx: 0, segment_id: "OLD0", audio_start: 0, audio_end: 10 },
          { scene_idx: 1, segment_id: "OLD1", audio_start: 10, audio_end: 20 },
        ],
        scene_idx: 0,
        pick_index: 0,
        new_segment_id: "NEW123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.timeline).toHaveLength(2);
    expect(body.timeline[0]).toMatchObject({ scene_idx: 0, segment_id: "NEW123", picker_reason: "בחירה ידנית" });
    expect(body.timeline[1]).toMatchObject({ scene_idx: 1, segment_id: "OLD1" });
    expect(mockUpdatePlanBundle).toHaveBeenCalledWith("job-1", expect.objectContaining({ timeline: expect.any(Array) }));
  });

  it("APPEND: with pick_index omitted, adds a new pick to a scene that has 0 picks", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(
      makeRequest({
        job_id: "job-1",
        scenes: [scene0, scene1],
        timeline: [{ scene_idx: 1, segment_id: "OLD1", audio_start: 10, audio_end: 20 }],
        scene_idx: 0,
        new_segment_id: "NEW123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.timeline).toHaveLength(2);
    // New pick should be inserted BEFORE the scene-1 pick (scene-0 has no prior
    // picks, so insert at the front of the timeline).
    expect(body.timeline[0]).toMatchObject({ scene_idx: 0, segment_id: "NEW123", audio_start: 0, audio_end: 10 });
    expect(body.timeline[1]).toMatchObject({ scene_idx: 1, segment_id: "OLD1" });
  });

  it("APPEND: scene with an existing pick gets a second pick inserted at the right spot", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(
      makeRequest({
        job_id: "job-1",
        scenes: [scene0, scene1],
        timeline: [
          { scene_idx: 0, segment_id: "OLD0", audio_start: 0, audio_end: 5 },
          { scene_idx: 1, segment_id: "OLD1", audio_start: 10, audio_end: 20 },
        ],
        scene_idx: 0,
        new_segment_id: "NEW123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeline).toHaveLength(3);
    expect(body.timeline.map((p: { scene_idx: number; segment_id: string }) => [p.scene_idx, p.segment_id])).toEqual([
      [0, "OLD0"],
      [0, "NEW123"],
      [1, "OLD1"],
    ]);
    // The new pick covers the gap from OLD0.audio_end (5) to scene.end_sec (10).
    expect(body.timeline[1]).toMatchObject({ audio_start: 5, audio_end: 10 });
  });

  it("APPEND: also triggers when pick_index is explicitly -1", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(
      makeRequest({
        job_id: "job-1",
        scenes: [scene0],
        timeline: [],
        scene_idx: 0,
        pick_index: -1,
        new_segment_id: "NEW123",
      }) as never,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.timeline).toHaveLength(1);
    expect(body.timeline[0]).toMatchObject({ scene_idx: 0, segment_id: "NEW123" });
  });

  it("rejects unknown segment_id", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(
      makeRequest({
        job_id: "job-1",
        scenes: [scene0],
        timeline: [],
        scene_idx: 0,
        new_segment_id: "DOES_NOT_EXIST",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Unknown segment/);
  });

  it("rejects missing job_id / scenes / scene_idx / new_segment_id", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const cases: Array<[Record<string, unknown>, RegExp]> = [
      [{ scenes: [scene0], scene_idx: 0, new_segment_id: "NEW123" }, /job_id/],
      [{ job_id: "j", scenes: [], scene_idx: 0, new_segment_id: "NEW123" }, /scenes/],
      [{ job_id: "j", scenes: [scene0], new_segment_id: "NEW123" }, /scene_idx/],
      [{ job_id: "j", scenes: [scene0], scene_idx: 0 }, /new_segment_id/],
    ];
    for (const [payload, expectedError] of cases) {
      const res = await POST(makeRequest(payload) as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toMatch(expectedError);
    }
  });

  it("SWAP: 400 when pick_index does not exist for the scene", async () => {
    const { POST } = await import("@/app/api/pick_segment/route");
    const res = await POST(
      makeRequest({
        job_id: "job-1",
        scenes: [scene0],
        timeline: [{ scene_idx: 0, segment_id: "OLD0", audio_start: 0, audio_end: 10 }],
        scene_idx: 0,
        pick_index: 5,
        new_segment_id: "NEW123",
      }) as never,
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/Pick index 5 not found/);
  });
});
