// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Store from "@/server/jobs/store";

vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => false,
  tenantKey: (k: string) => `tenants/test/${k}`,
  putR2Text: vi.fn(),
}));
vi.mock("@/server/sync/r2/mirror-queue", () => ({ enqueueMirror: vi.fn() }));

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

async function importFresh() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  const paths = await import("@/server/runtime/paths");
  const store = await import("@/server/jobs/store");
  store.resetJobsStore();
  return { store, paths };
}

const HOUR = 60 * 60 * 1000;

function ageFile(p: string, ms: number) {
  const t = (Date.now() - ms) / 1000;
  fs.utimesSync(p, t, t);
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-gc-"));
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

describe("sweepOrphanRuntimeFiles (via crashRecoverySweep)", () => {
  it("deletes orphan uploads past the grace window but keeps owned/recent ones", async () => {
    const { store, paths } = await importFresh();
    const { uploadsDir } = paths.getRuntimePaths();
    fs.mkdirSync(uploadsDir, { recursive: true });

    const orphanOld = path.join(uploadsDir, "orphan-old.mp3");
    const orphanNew = path.join(uploadsDir, "orphan-new.mp3");
    const owned = path.join(uploadsDir, "owned.mp3");
    fs.writeFileSync(orphanOld, "x");
    fs.writeFileSync(orphanNew, "x");
    fs.writeFileSync(owned, "x");
    ageFile(orphanOld, 2 * HOUR); // past 1h grace
    ageFile(owned, 2 * HOUR); // old, but owned by a job

    (store as typeof Store).upsertJob({
      job_id: "j1",
      status: "completed",
      audio_filename: "owned.mp3",
      created_at: new Date().toISOString(),
    });

    store.crashRecoverySweep();

    expect(fs.existsSync(orphanOld)).toBe(false); // swept
    expect(fs.existsSync(orphanNew)).toBe(true); // within grace window
    expect(fs.existsSync(owned)).toBe(true); // owned by a job
  });

  it("removes render temp dirs for inactive jobs, keeps active ones", async () => {
    const { store, paths } = await importFresh();
    const { renderTmpDir } = paths.getRuntimePaths();
    const activeDir = path.join(renderTmpDir, "active-job");
    const strayDir = path.join(renderTmpDir, "stray-job");
    fs.mkdirSync(activeDir, { recursive: true });
    fs.mkdirSync(strayDir, { recursive: true });

    (store as typeof Store).upsertJob({
      job_id: "active-job",
      status: "queued",
      created_at: new Date().toISOString(),
    });
    // stray-job has no active record (completed or gone).

    store.crashRecoverySweep();

    expect(fs.existsSync(activeDir)).toBe(true); // owned by a queued job
    expect(fs.existsSync(strayDir)).toBe(false); // swept
  });
});
