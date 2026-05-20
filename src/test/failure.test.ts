// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Store from "@/server/jobs/store";

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
  const failure = await import("@/server/jobs/failure");
  return { store, failure };
}

function seedJob(store: typeof Store, jobId: string) {
  store.upsertJob({
    job_id: jobId,
    status: "processing",
    created_at: new Date().toISOString(),
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-failure-"));
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

describe("recordJobFailure", () => {
  it("persists the mapped fields onto the job", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.recordJobFailure("j1", "scene_planner", new Error("ignored"), {
      status: 502,
      body: {
        success: false,
        error: "אזל המאגר",
        error_code: "llm_quota_exceeded",
        provider: "openai",
        console_url: "https://platform.openai.com/account/billing",
      },
    });

    const job = store.getJob("j1");
    expect(job?.error).toBe("אזל המאגר");
    expect(job?.error_code).toBe("llm_quota_exceeded");
    expect(job?.error_provider).toBe("openai");
    expect(job?.error_console_url).toBe("https://platform.openai.com/account/billing");
    expect(job?.failed_step).toBe("scene_planner");
    expect(job?.failed_at).toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it("falls back to the Error message and 'unknown' code when no mapped body", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.recordJobFailure("j1", "picker", new Error("boom"));

    const job = store.getJob("j1");
    expect(job?.error).toBe("boom");
    expect(job?.error_code).toBe("unknown");
    expect(job?.failed_step).toBe("picker");
  });

  it("first failure wins — does not overwrite a prior recorded failure", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.recordJobFailure("j1", "scene_planner", new Error("first"));
    const afterFirst = store.getJob("j1");
    const originalFailedAt = afterFirst?.failed_at;

    failure.recordJobFailure("j1", "picker", new Error("second"));

    const after = store.getJob("j1");
    expect(after?.error).toBe("first");
    expect(after?.failed_step).toBe("scene_planner");
    expect(after?.failed_at).toBe(originalFailedAt);
  });

  it("no-ops on unknown jobId and empty jobId", async () => {
    const { store, failure } = await importFresh();
    expect(() => failure.recordJobFailure("nope", "picker", new Error("x"))).not.toThrow();
    expect(() => failure.recordJobFailure("", "picker", new Error("x"))).not.toThrow();
    expect(store.getJob("nope")).toBeUndefined();
  });
});

describe("recordPickerFailure", () => {
  it("uses the picker_status error_code and Hebrew message", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.recordPickerFailure("j1", { error_code: "picker_empty" }, "בחירת הקליפים נכשלה.");

    const job = store.getJob("j1");
    expect(job?.error).toBe("בחירת הקליפים נכשלה.");
    expect(job?.error_code).toBe("picker_empty");
    expect(job?.failed_step).toBe("picker");
  });

  it("falls back to 'picker_failed' when the picker_status has no code", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.recordPickerFailure("j1", {}, "בחירת הקליפים נכשלה.");

    expect(store.getJob("j1")?.error_code).toBe("picker_failed");
  });
});

describe("markRenderFailed", () => {
  it("flips status to failed and writes the failure metadata", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.markRenderFailed("j1", "render_ffmpeg_failed", "ffmpeg crashed", "ffmpeg");

    const job = store.getJob("j1");
    expect(job?.status).toBe("failed");
    expect(job?.error_code).toBe("render_ffmpeg_failed");
    expect(job?.error_provider).toBe("ffmpeg");
    expect(job?.failed_step).toBe("render");
  });

  it("defaults provider to 'worker' when omitted", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");

    failure.markRenderFailed("j1", "worker_unknown", "boom");

    expect(store.getJob("j1")?.error_provider).toBe("worker");
  });
});

describe("markJobCompleted", () => {
  it("sets status + output_url and wipes any prior failure fields", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");
    // Simulate a prior failed run that left metadata behind.
    failure.markRenderFailed("j1", "render_ffmpeg_failed", "old failure", "ffmpeg");

    failure.markJobCompleted("j1", "forecast_j1.mp4");

    const job = store.getJob("j1");
    expect(job?.status).toBe("completed");
    expect(job?.output_url).toBe("forecast_j1.mp4");
    expect(job?.error).toBeNull();
    expect(job?.error_code).toBeNull();
    expect(job?.failed_step).toBeNull();
    expect(job?.failed_at).toBeNull();
  });
});

describe("clearJobFailure", () => {
  it("nulls every error_* field without touching status", async () => {
    const { store, failure } = await importFresh();
    seedJob(store, "j1");
    failure.markRenderFailed("j1", "render_ffmpeg_failed", "boom", "ffmpeg");

    failure.clearJobFailure("j1");

    const job = store.getJob("j1");
    expect(job?.status).toBe("failed"); // unchanged
    expect(job?.error).toBeNull();
    expect(job?.error_code).toBeNull();
    expect(job?.error_provider).toBeNull();
    expect(job?.error_console_url).toBeNull();
    expect(job?.failed_step).toBeNull();
    expect(job?.failed_at).toBeNull();
  });
});
