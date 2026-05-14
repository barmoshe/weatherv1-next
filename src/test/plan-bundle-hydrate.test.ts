import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ctx = { root: "" as string, outputsDir: "" as string };

vi.mock("@/server/runtime/paths", () => ({
  getRuntimePaths: () => ({
    runtimeDir: ctx.root,
    uploadsDir: path.join(ctx.root, "uploads"),
    outputsDir: ctx.outputsDir,
    cacheDir: path.join(ctx.root, "cache"),
    tmpDir: path.join(ctx.root, "tmp"),
    renderTmpDir: path.join(ctx.root, "tmp", "renders"),
    postersDir: path.join(ctx.root, "cache", "posters"),
    previewsDir: path.join(ctx.root, "cache", "previews"),
    segmentPostersDir: path.join(ctx.root, "cache", "segment_posters"),
  }),
}));

const mockR2Configured = vi.fn(() => true);
const mockHeadR2Object = vi.fn();
const mockGetR2Text = vi.fn();

vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => mockR2Configured(),
  tenantKey: (rel: string) => `tenants/x/${rel}`,
  headR2Object: (...args: unknown[]) => mockHeadR2Object(...args),
  getR2Text: (...args: unknown[]) => mockGetR2Text(...args),
  putR2Text: vi.fn(),
}));

import { hydratePlanBundleFromR2 } from "@/server/jobs/plan-bundle";

describe("hydratePlanBundleFromR2", () => {
  const jobId = "job-abc";
  const dest = () => path.join(ctx.outputsDir, `forecast_${jobId}.plan.json`);

  beforeEach(() => {
    vi.clearAllMocks();
    ctx.root = fs.mkdtempSync(path.join(os.tmpdir(), "wv1-plan-"));
    ctx.outputsDir = path.join(ctx.root, "outputs");
    fs.mkdirSync(ctx.outputsDir, { recursive: true });
    mockR2Configured.mockReturnValue(true);
    mockHeadR2Object.mockResolvedValue({ etag: '"1"' });
    mockGetR2Text.mockResolvedValue({
      text: JSON.stringify({ job_id: jobId, transcript: "hello" }),
    });
  });

  afterEach(() => {
    fs.rmSync(ctx.root, { recursive: true, force: true });
  });

  it("skips R2 when local bundle is complete and force is off", async () => {
    fs.writeFileSync(dest(), JSON.stringify({ job_id: jobId, old: true }, null, 2), "utf8");
    const ok = await hydratePlanBundleFromR2(jobId);
    expect(ok).toBe(false);
    expect(mockGetR2Text).not.toHaveBeenCalled();
  });

  it("overwrites local from R2 when force is true", async () => {
    fs.writeFileSync(dest(), JSON.stringify({ job_id: jobId, old: true }, null, 2), "utf8");
    const ok = await hydratePlanBundleFromR2(jobId, { force: true });
    expect(ok).toBe(true);
    expect(mockGetR2Text).toHaveBeenCalled();
    const disk = JSON.parse(fs.readFileSync(dest(), "utf8")) as { transcript?: string; old?: boolean };
    expect(disk.transcript).toBe("hello");
    expect(disk.old).toBeUndefined();
  });

  it("hydrates when local is missing", async () => {
    const ok = await hydratePlanBundleFromR2(jobId);
    expect(ok).toBe(true);
    expect(fs.existsSync(dest())).toBe(true);
  });

  it("returns false when R2 is not configured", async () => {
    mockR2Configured.mockReturnValue(false);
    const ok = await hydratePlanBundleFromR2(jobId, { force: true });
    expect(ok).toBe(false);
  });
});
