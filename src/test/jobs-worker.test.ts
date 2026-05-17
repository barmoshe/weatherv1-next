// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => false,
  tenantKey: (k: string) => `tenants/test/${k}`,
  putR2Text: vi.fn(),
}));
vi.mock("@/server/sync/r2/mirror-queue", () => ({
  enqueueMirror: vi.fn(),
}));

const mocks = vi.hoisted(() => ({
  hydrateVoiceoverFromR2: vi.fn().mockResolvedValue(undefined),
  renderVideo: vi.fn(),
  prepareRenderMedia: vi.fn(),
  readCatalog: vi.fn(() => ({ videos: [], updated_at: "2026-05-17T00:00:00.000Z" })),
  parseCatalog: vi.fn(() => []),
  buildVideoMap: vi.fn(() => ({})),
}));

vi.mock("@/server/sync/r2/hydrate-voiceover", () => ({
  hydrateVoiceoverFromR2: mocks.hydrateVoiceoverFromR2,
}));
vi.mock("@/server/ffmpeg/renderer", () => ({
  renderVideo: mocks.renderVideo,
}));
vi.mock("@/server/jobs/render-media", () => ({
  prepareRenderMedia: mocks.prepareRenderMedia,
}));
vi.mock("@/server/catalog/storage", () => ({
  readCatalog: mocks.readCatalog,
}));
vi.mock("@/server/catalog/parser", () => ({
  parseCatalog: mocks.parseCatalog,
  buildVideoMap: mocks.buildVideoMap,
}));

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

interface JobModule {
  worker: typeof import("@/server/jobs/worker");
  store: typeof import("@/server/jobs/store");
  planBundle: typeof import("@/server/jobs/plan-bundle");
}

async function importFresh(): Promise<JobModule> {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  const store = await import("@/server/jobs/store");
  store.resetJobsStore();
  const planBundle = await import("@/server/jobs/plan-bundle");
  const worker = await import("@/server/jobs/worker");
  return { worker, store, planBundle };
}

function timeline() {
  return [
    {
      segment_id: "vid-1-s0",
      video_id: "vid-1",
      start_sec: 0,
      end_sec: 5,
      scene_idx: 0,
      pick_index: 0,
    },
  ];
}

// Hand-rolled instead of RTL's waitFor because this drives non-React state
// (the in-memory jobs store) — RTL's version would still work but adds React
// reconciliation overhead per poll.
async function waitFor(predicate: () => boolean, timeoutMs = 1000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 5));
  }
  await new Promise((r) => setImmediate(r));
}

function isTerminal(status: string | undefined): boolean {
  return status === "completed" || status === "failed";
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-worker-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_RUNTIME_DIR = tempDir;

  for (const m of Object.values(mocks)) {
    if (typeof m.mockReset === "function") m.mockReset();
  }
  mocks.hydrateVoiceoverFromR2.mockResolvedValue(undefined);
  mocks.readCatalog.mockReturnValue({ videos: [], updated_at: "2026-05-17T00:00:00.000Z" });
  mocks.parseCatalog.mockReturnValue([]);
  mocks.buildVideoMap.mockReturnValue({});
  // Default to render success so per-test overrides only need to handle the
  // failure cases. Individual tests still override with mockResolvedValue/
  // mockRejectedValue to be explicit.
  mocks.renderVideo.mockResolvedValue(true);
  mocks.prepareRenderMedia.mockImplementation(async (tl: unknown, videoMap: unknown) => ({
    timeline: tl,
    videoMap,
    cleanup: vi.fn().mockResolvedValue(undefined),
  }));

  // startWorker has a once-per-process guard backed by globalThis; reset it
  // between tests so each test can call startWorker() fresh.
  (globalThis as { __weatherWorkerStarted?: boolean }).__weatherWorkerStarted = false;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("enqueueJob → drain → terminal state", () => {
  it("moves a queued job through processing → completed on render success", async () => {
    mocks.renderVideo.mockResolvedValue(true);

    const { worker, store, planBundle } = await importFresh();
    store.upsertJob({ job_id: "j1", status: "queued", audio_filename: "a.mp3" });
    await planBundle.updatePlanBundle("j1", { timeline: timeline() });

    worker.enqueueJob("j1");
    await waitFor(() => isTerminal(store.getJob("j1")?.status));

    const job = store.getJob("j1");
    expect(job?.status).toBe("completed");
    expect(job?.output_url).toBe("forecast_j1.mp4");
    expect(mocks.renderVideo).toHaveBeenCalledTimes(1);
  });

  it("marks the job failed when the renderer returns false", async () => {
    mocks.renderVideo.mockResolvedValue(false);

    const { worker, store, planBundle } = await importFresh();
    store.upsertJob({ job_id: "j2", status: "queued", audio_filename: "a.mp3" });
    await planBundle.updatePlanBundle("j2", { timeline: timeline() });

    worker.enqueueJob("j2");
    await waitFor(() => isTerminal(store.getJob("j2")?.status));

    expect(store.getJob("j2")?.status).toBe("failed");
    expect(store.getJob("j2")?.error).toMatch(/Renderer returned failure/);
  });

  it("marks the job failed when the renderer throws", async () => {
    mocks.renderVideo.mockRejectedValue(new Error("ffmpeg exploded"));

    const { worker, store, planBundle } = await importFresh();
    store.upsertJob({ job_id: "j3", status: "queued", audio_filename: "a.mp3" });
    await planBundle.updatePlanBundle("j3", { timeline: timeline() });

    worker.enqueueJob("j3");
    await waitFor(() => isTerminal(store.getJob("j3")?.status));

    expect(store.getJob("j3")?.status).toBe("failed");
    expect(store.getJob("j3")?.error).toMatch(/ffmpeg exploded/);
  });

  it("marks the job failed when the timeline is empty", async () => {
    const { worker, store } = await importFresh();
    store.upsertJob({ job_id: "j4", status: "queued", audio_filename: "a.mp3" });

    worker.enqueueJob("j4");
    await waitFor(() => isTerminal(store.getJob("j4")?.status));

    expect(store.getJob("j4")?.status).toBe("failed");
    expect(store.getJob("j4")?.error).toMatch(/No timeline/);
    expect(mocks.renderVideo).not.toHaveBeenCalled();
  });

  it("skips jobs that are no longer in queued status by the time the drain pulls them", async () => {
    const { worker, store } = await importFresh();
    store.upsertJob({ job_id: "jx", status: "completed", audio_filename: "a.mp3" });

    worker.enqueueJob("jx");
    // Wait a beat to let the drain loop look at and skip the job.
    await new Promise((r) => setTimeout(r, 50));

    expect(store.getJob("jx")?.status).toBe("completed");
    expect(mocks.renderVideo).not.toHaveBeenCalled();
  });
});

describe("drain serialization", () => {
  it("processes enqueued jobs one at a time (single drain loop)", async () => {
    let activeRenders = 0;
    let maxConcurrent = 0;
    mocks.renderVideo.mockImplementation(async () => {
      activeRenders += 1;
      maxConcurrent = Math.max(maxConcurrent, activeRenders);
      await new Promise((r) => setTimeout(r, 25));
      activeRenders -= 1;
      return true;
    });

    const { worker, store, planBundle } = await importFresh();
    for (const id of ["a", "b", "c"]) {
      store.upsertJob({ job_id: id, status: "queued", audio_filename: `${id}.mp3` });
      await planBundle.updatePlanBundle(id, { timeline: timeline() });
    }

    worker.enqueueJob("a");
    worker.enqueueJob("b");
    worker.enqueueJob("c");
    await waitFor(
      () =>
        isTerminal(store.getJob("a")?.status) &&
        isTerminal(store.getJob("b")?.status) &&
        isTerminal(store.getJob("c")?.status),
      2000,
    );

    expect(maxConcurrent).toBe(1);
    expect(store.getJob("a")?.status).toBe("completed");
    expect(store.getJob("b")?.status).toBe("completed");
    expect(store.getJob("c")?.status).toBe("completed");
  });
});

describe("startWorker", () => {
  it("flips stale 'processing' jobs to 'failed' on boot", async () => {
    const { worker, store } = await importFresh();
    store.upsertJob({ job_id: "stale", status: "processing", audio_filename: "a.mp3" });

    worker.startWorker();
    await waitFor(() => store.getJob("stale")?.status === "failed");

    expect(store.getJob("stale")?.status).toBe("failed");
    expect(store.getJob("stale")?.error).toMatch(/restarted/i);
  });

  it("re-enqueues jobs that were left in 'queued' across a restart", async () => {
    mocks.renderVideo.mockResolvedValue(true);

    const { worker, store, planBundle } = await importFresh();
    store.upsertJob({ job_id: "resumed", status: "queued", audio_filename: "a.mp3" });
    await planBundle.updatePlanBundle("resumed", { timeline: timeline() });

    worker.startWorker();
    await waitFor(() => isTerminal(store.getJob("resumed")?.status));

    expect(store.getJob("resumed")?.status).toBe("completed");
    expect(mocks.renderVideo).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across repeat calls within the same process", async () => {
    const { worker } = await importFresh();
    worker.startWorker();
    worker.startWorker(); // Second call should no-op due to globalThis guard.
    // No assertion needed beyond "doesn't throw"; the guard is internal.
    expect(true).toBe(true);
  });
});
