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
vi.mock("@/server/sync/r2/mirror-queue", () => ({ enqueueMirror: vi.fn() }));

// Render bundle lookup — configurable per test so we can exercise the
// "resumable" vs "unresumable" branches of the interrupted recovery.
const mockReadPlanBundle = vi.fn();
let tempDir: string;
vi.mock("@/server/jobs/plan-bundle", () => ({
  readPlanBundle: (...a: unknown[]) => mockReadPlanBundle(...a),
  updatePlanBundle: vi.fn(async () => {}),
  planBundlePath: (id: string) => path.join(tempDir, `${id}.plan.json`),
}));

// Heavy render-path deps mocked so any drain triggered by re-enqueue is a no-op.
vi.mock("@/server/ffmpeg/renderer", () => ({ renderVideo: vi.fn(async () => true) }));
vi.mock("@/server/catalog/storage", () => ({ readCatalog: () => "" }));
vi.mock("@/server/catalog/parser", () => ({ parseCatalog: () => [], buildVideoMap: () => ({}) }));
vi.mock("@/server/sync/r2/hydrate-voiceover", () => ({ hydrateVoiceoverFromR2: vi.fn(async () => {}) }));
vi.mock("@/server/jobs/render-media", () => ({
  prepareRenderMedia: vi.fn(async () => ({ timeline: [], videoMap: {}, cleanup: vi.fn(async () => {}) })),
}));
vi.mock("@/server/pipeline/validator", () => ({ sortTimelineForRender: vi.fn() }));

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

async function importFresh() {
  vi.resetModules();
  // startWorker guards on a globalThis flag so HMR can't double-start it —
  // clear it so each test gets a fresh boot.
  (globalThis as { __weatherWorkerStarted?: boolean }).__weatherWorkerStarted = undefined;
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  const store = await import("@/server/jobs/store");
  store.resetJobsStore();
  const worker = await import("@/server/jobs/worker");
  return { store, worker };
}

function seed(store: typeof Store, jobId: string, patch: Partial<Store.JobRecord>) {
  store.upsertJob({
    job_id: jobId,
    status: "processing",
    created_at: new Date().toISOString(),
    ...patch,
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-crash-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_RUNTIME_DIR = tempDir;
  mockReadPlanBundle.mockReset();
  mockReadPlanBundle.mockReturnValue({ timeline: [{ video_id: "v1", segment_id: "s1" }] });
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  // maxRetries: a fire-and-forget mutateAndPersist lock write may still be in
  // flight; on Windows that makes rmdir fail ENOTEMPTY until the lock releases.
  fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
});

describe("crashRecoverySweep", () => {
  it("flips processing -> interrupted with no failure metadata", async () => {
    const { store } = await importFresh();
    seed(store, "j1", { status: "processing", progress: 0.4, eta_sec: 12 });

    store.crashRecoverySweep();

    const job = store.getJob("j1");
    expect(job?.status).toBe("interrupted");
    expect(job?.failed_at == null).toBe(true);
    expect(job?.error == null).toBe(true);
    expect(job?.progress).toBeNull();
    expect(job?.eta_sec).toBeNull();
  });
});

describe("startWorker interrupted recovery", () => {
  it("promotes a resumable interrupted job back to queued and bumps interrupt_count", async () => {
    const { store, worker } = await importFresh();
    seed(store, "j1", { status: "processing", audio_filename: "a.mp3" });

    worker.startWorker(); // runs crashRecoverySweep then resumes

    const job = store.getJob("j1");
    expect(job?.status).toBe("queued");
    expect(job?.interrupt_count).toBe(1);
  });

  it("fails an interrupted job that exhausted its retry budget", async () => {
    const { store, worker } = await importFresh();
    seed(store, "j1", { status: "interrupted", audio_filename: "a.mp3", interrupt_count: 3 });

    worker.startWorker();

    const job = store.getJob("j1");
    expect(job?.status).toBe("failed");
    expect(job?.error_code).toBe("interrupted_retry_exhausted");
  });

  it("fails an interrupted job with no resumable work (missing timeline)", async () => {
    mockReadPlanBundle.mockReturnValue({ timeline: [] });
    const { store, worker } = await importFresh();
    seed(store, "j1", { status: "interrupted", audio_filename: "a.mp3" });

    worker.startWorker();

    const job = store.getJob("j1");
    expect(job?.status).toBe("failed");
    expect(job?.error_code).toBe("interrupted_unresumable");
  });
});

describe("schema round-trip", () => {
  it("preserves interrupted status + progress through the Zod read", async () => {
    const { store } = await importFresh();
    // Write the file directly, then read it back through the store's schema —
    // this catches the "forgot to add the field/status to Zod" regression,
    // which would silently strip it on read.
    fs.writeFileSync(
      path.join(tempDir, "jobs.json"),
      JSON.stringify({
        j1: {
          job_id: "j1",
          status: "interrupted",
          progress: 0.5,
          eta_sec: 8,
          interrupt_count: 1,
          created_at: new Date().toISOString(),
        },
      }),
    );

    store.resetJobsStore(); // force a re-read from disk through the Zod schema
    const job = store.getJob("j1");
    expect(job?.status).toBe("interrupted");
    expect(job?.progress).toBe(0.5);
    expect(job?.eta_sec).toBe(8);
    expect(job?.interrupt_count).toBe(1);
  });
});
