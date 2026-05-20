// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetJob = vi.fn();
const mockUpdateJob = vi.fn();
const mockClearJobFailure = vi.fn();
const mockEnqueueJob = vi.fn();
const mockReadPlanBundle = vi.fn();

vi.mock("@/server/runtime/auth", () => ({ assertDesktopAuth: vi.fn(() => null) }));
vi.mock("@/server/jobs/store", () => ({
  getJob: (...a: unknown[]) => mockGetJob(...a),
  updateJob: (...a: unknown[]) => mockUpdateJob(...a),
}));
vi.mock("@/server/jobs/failure", () => ({
  clearJobFailure: (...a: unknown[]) => mockClearJobFailure(...a),
}));
vi.mock("@/server/jobs/worker", () => ({
  enqueueJob: (...a: unknown[]) => mockEnqueueJob(...a),
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  readPlanBundle: (...a: unknown[]) => mockReadPlanBundle(...a),
}));

function request() {
  return new Request("http://localhost/api/jobs/j1/retry", { method: "POST" });
}

async function callRoute() {
  const route = await import("@/app/api/jobs/[jobId]/retry/route");
  return route.POST(request() as never, {
    params: Promise.resolve({ jobId: "j1" }),
  });
}

beforeEach(() => {
  mockGetJob.mockReset();
  mockUpdateJob.mockReset();
  mockClearJobFailure.mockReset();
  mockEnqueueJob.mockReset();
  mockReadPlanBundle.mockReset();
});

describe("POST /api/jobs/:jobId/retry", () => {
  it("returns 404 when the job does not exist", async () => {
    mockGetJob.mockReturnValue(undefined);
    const res = await callRoute();

    expect(res.status).toBe(404);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 409 when the job is not in a failed state", async () => {
    mockGetJob.mockReturnValue({ job_id: "j1", status: "processing", audio_filename: "a.mp3" });
    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/processing/);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 422 when the failed job has no recorded audio file", async () => {
    mockGetJob.mockReturnValue({ job_id: "j1", status: "failed", audio_filename: undefined });
    const res = await callRoute();

    expect(res.status).toBe(422);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("returns 422 when the plan bundle is missing a timeline", async () => {
    mockGetJob.mockReturnValue({ job_id: "j1", status: "failed", audio_filename: "a.mp3" });
    mockReadPlanBundle.mockReturnValue({ timeline: [] });
    const res = await callRoute();

    expect(res.status).toBe(422);
    expect(mockEnqueueJob).not.toHaveBeenCalled();
  });

  it("requeues, clears the failure, and enqueues on success", async () => {
    mockGetJob.mockReturnValue({ job_id: "j1", status: "failed", audio_filename: "a.mp3" });
    mockReadPlanBundle.mockReturnValue({ timeline: [{ video_id: "v1", segment_id: "s1" }] });
    const res = await callRoute();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ success: true, job_id: "j1" });
    expect(mockUpdateJob).toHaveBeenCalledWith("j1", { status: "queued" });
    expect(mockClearJobFailure).toHaveBeenCalledWith("j1");
    expect(mockEnqueueJob).toHaveBeenCalledWith("j1");
  });
});
