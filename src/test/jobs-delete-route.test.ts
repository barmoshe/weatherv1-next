// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertDesktopAuth: vi.fn(),
  getJob: vi.fn(),
  killProcess: vi.fn(),
  deleteJob: vi.fn(),
}));

vi.mock("@/server/runtime/auth", () => ({
  assertDesktopAuth: (req: unknown) => mocks.assertDesktopAuth(req),
}));
vi.mock("@/server/jobs/store", () => ({
  getJob: mocks.getJob,
  deleteJob: mocks.deleteJob,
}));
vi.mock("@/server/ffmpeg/spawn", () => ({
  killProcess: mocks.killProcess,
}));

function deleteRequest(jobId: string) {
  return new Request(`http://localhost/api/jobs/${jobId}`, { method: "DELETE" });
}

function params(jobId: string) {
  return { params: Promise.resolve({ jobId }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.assertDesktopAuth.mockReturnValue(null);
});

describe("DELETE /api/jobs/[jobId]", () => {
  it("returns 401 when auth denies", async () => {
    const { NextResponse } = await import("next/server");
    mocks.assertDesktopAuth.mockReturnValueOnce(
      NextResponse.json({ success: false }, { status: 401 }),
    );
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");
    const res = await DELETE(deleteRequest("job-1") as never, params("job-1") as never);
    expect(res.status).toBe(401);
    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.deleteJob).not.toHaveBeenCalled();
  });

  it("returns 200 with deleted=false when the job does not exist", async () => {
    mocks.getJob.mockReturnValueOnce(undefined);
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");
    const res = await DELETE(deleteRequest("ghost") as never, params("ghost") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, job_id: "ghost", deleted: false });
    expect(mocks.killProcess).not.toHaveBeenCalled();
    expect(mocks.deleteJob).not.toHaveBeenCalled();
  });

  it("kills any running process and deletes the job when it exists", async () => {
    mocks.getJob.mockReturnValueOnce({ job_id: "job-9", status: "processing" });
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");
    const res = await DELETE(deleteRequest("job-9") as never, params("job-9") as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, job_id: "job-9", deleted: true });
    expect(mocks.killProcess).toHaveBeenCalledWith("job-9");
    expect(mocks.deleteJob).toHaveBeenCalledWith("job-9");
  });

  it("calls killProcess before deleteJob", async () => {
    const order: string[] = [];
    mocks.killProcess.mockImplementation(() => {
      order.push("kill");
    });
    mocks.deleteJob.mockImplementation(() => {
      order.push("delete");
      return true;
    });
    mocks.getJob.mockReturnValueOnce({ job_id: "j", status: "queued" });

    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");
    await DELETE(deleteRequest("j") as never, params("j") as never);
    expect(order).toEqual(["kill", "delete"]);
  });
});
