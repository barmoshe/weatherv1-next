// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const mockReadPlanBundle = vi.fn();
const mockHydratePlanBundle = vi.fn();
const mockHydrateVoiceover = vi.fn();
const mockServeRuntimeFile = vi.fn();
let uploadsDir: string;

vi.mock("@/server/runtime/paths", () => ({
  getRuntimePaths: () => ({ uploadsDir }),
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  readPlanBundle: (...args: unknown[]) => mockReadPlanBundle(...args),
  hydratePlanBundleFromR2: (...args: unknown[]) => mockHydratePlanBundle(...args),
}));
vi.mock("@/server/sync/r2/hydrate-voiceover", () => ({
  hydrateVoiceoverFromR2: (...args: unknown[]) => mockHydrateVoiceover(...args),
}));
vi.mock("@/server/runtime/serve-file", () => ({
  serveRuntimeFile: (...args: unknown[]) => mockServeRuntimeFile(...args),
}));

function request() {
  return new Request("http://localhost/api/voiceovers/job-1");
}

describe("/api/voiceovers/[jobId] route", () => {
  beforeEach(() => {
    uploadsDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-vo-route-"));
    mockReadPlanBundle.mockReset();
    mockHydratePlanBundle.mockReset().mockResolvedValue(false);
    mockHydrateVoiceover.mockReset();
    mockServeRuntimeFile.mockReset().mockReturnValue(
      new NextResponse(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
  });
  afterEach(() => {
    fs.rmSync(uploadsDir, { recursive: true, force: true });
  });

  it("serves directly when audio_filename is set and the local file exists", async () => {
    mockReadPlanBundle.mockReturnValue({ audio_filename: "abc.mp3" });
    fs.writeFileSync(path.join(uploadsDir, "abc.mp3"), Buffer.alloc(4, 9));

    const { GET } = await import("@/app/api/voiceovers/[jobId]/route");
    const res = await GET(request() as never, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(res.status).toBe(200);
    expect(mockHydratePlanBundle).not.toHaveBeenCalled();
    expect(mockHydrateVoiceover).not.toHaveBeenCalled();
    expect(mockServeRuntimeFile).toHaveBeenCalledTimes(1);
  });

  it("self-heals: hydrates voiceover from R2 when local file is missing", async () => {
    mockReadPlanBundle.mockReturnValue({ audio_filename: "abc.mp3" });
    // No file written to uploadsDir — simulate fresh machine.
    mockHydrateVoiceover.mockImplementation(async (_jobId, _filename, localPath) => {
      fs.writeFileSync(localPath, Buffer.alloc(8, 7));
    });

    const { GET } = await import("@/app/api/voiceovers/[jobId]/route");
    const res = await GET(request() as never, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(res.status).toBe(200);
    expect(mockHydrateVoiceover).toHaveBeenCalledWith(
      "job-1",
      "abc.mp3",
      path.join(uploadsDir, "abc.mp3"),
    );
    expect(mockServeRuntimeFile).toHaveBeenCalledTimes(1);
  });

  it("self-heals: hydrates plan bundle from R2 when audio_filename is missing locally", async () => {
    mockReadPlanBundle
      .mockReturnValueOnce({}) // first read: bundle is empty (not yet restored)
      .mockReturnValueOnce({ audio_filename: "abc.mp3" }); // after R2 hydrate
    fs.writeFileSync(path.join(uploadsDir, "abc.mp3"), Buffer.alloc(4, 9));

    const { GET } = await import("@/app/api/voiceovers/[jobId]/route");
    const res = await GET(request() as never, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(res.status).toBe(200);
    expect(mockHydratePlanBundle).toHaveBeenCalledWith("job-1");
    expect(mockServeRuntimeFile).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when neither local nor R2 have the bundle audio_filename", async () => {
    mockReadPlanBundle.mockReturnValue({});
    mockHydratePlanBundle.mockResolvedValue(false);

    const { GET } = await import("@/app/api/voiceovers/[jobId]/route");
    const res = await GET(request() as never, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(res.status).toBe(404);
    expect(mockHydrateVoiceover).not.toHaveBeenCalled();
    expect(mockServeRuntimeFile).not.toHaveBeenCalled();
  });

  it("returns 404 when R2 voiceover hydration throws (e.g. R2 also has no audio for this job)", async () => {
    mockReadPlanBundle.mockReturnValue({ audio_filename: "abc.mp3" });
    mockHydrateVoiceover.mockRejectedValue(new Error("Voiceover missing in cloud (R2 404)"));

    const { GET } = await import("@/app/api/voiceovers/[jobId]/route");
    const res = await GET(request() as never, { params: Promise.resolve({ jobId: "job-1" }) });

    expect(res.status).toBe(404);
    expect(mockServeRuntimeFile).not.toHaveBeenCalled();
  });
});
