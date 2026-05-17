// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// R2 is not configured in tests — short-circuits the mirror enqueue path.
vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => false,
  tenantKey: (k: string) => `tenants/test/${k}`,
  putR2Text: vi.fn(),
}));
vi.mock("@/server/sync/r2/mirror-queue", () => ({
  enqueueMirror: vi.fn(),
}));

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

async function importFresh() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  const store = await import("@/server/jobs/store");
  store.resetJobsStore();
  return store;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-jobs-store-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_RUNTIME_DIR = tempDir;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("jobs store locking", () => {
  it("two parallel upsertJob calls both land in jobs.json", async () => {
    const store = await importFresh();
    store.upsertJob({ job_id: "j1", status: "queued", created_at: new Date().toISOString() });
    store.upsertJob({ job_id: "j2", status: "queued", created_at: new Date().toISOString() });

    // Give the lock-protected writes a moment to land (mutateAndPersistSync
    // fires void promises).
    await new Promise((r) => setTimeout(r, 200));

    const jobsPath = path.join(tempDir, "jobs.json");
    expect(fs.existsSync(jobsPath)).toBe(true);
    const raw = JSON.parse(fs.readFileSync(jobsPath, "utf8")) as Record<string, unknown>;
    expect(Object.keys(raw).sort()).toEqual(["j1", "j2"]);
  });

  it("survives a corrupt jobs.json on load (treats as empty)", async () => {
    const jobsPath = path.join(tempDir, "jobs.json");
    fs.writeFileSync(jobsPath, "not valid json");
    const store = await importFresh();
    expect(store.getAllJobs()).toEqual([]);
  });
});
