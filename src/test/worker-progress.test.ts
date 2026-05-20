// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Capture the options renderVideo is called with, and let the test drive
// onProgress to exercise the throttle.
let renderOpts: { jobId?: string; onProgress?: (p: number) => void } | undefined;
const mockRenderVideo = vi.fn((...args: unknown[]) => {
  renderOpts = args[4] as { jobId?: string; onProgress?: (p: number) => void } | undefined;
  return Promise.resolve(true);
});

const mockUpdateJob = vi.fn();
const mockGetJob = vi.fn();
const mockMarkJobCompleted = vi.fn();
const mockMarkRenderFailed = vi.fn();
const mockReadPlanBundle = vi.fn((..._a: unknown[]) => ({
  timeline: [{ video_id: "v1", segment_id: "s1" }],
}));

vi.mock("@/server/jobs/store", () => ({
  getJob: (...a: unknown[]) => mockGetJob(...a),
  updateJob: (...a: unknown[]) => mockUpdateJob(...a),
  crashRecoverySweep: vi.fn(),
  getAllJobs: vi.fn(() => []),
}));
vi.mock("@/server/jobs/failure", () => ({
  markJobCompleted: (...a: unknown[]) => mockMarkJobCompleted(...a),
  markRenderFailed: (...a: unknown[]) => mockMarkRenderFailed(...a),
}));
vi.mock("@/server/jobs/plan-bundle", () => ({
  readPlanBundle: (...a: unknown[]) => mockReadPlanBundle(...a),
  updatePlanBundle: vi.fn(async () => {}),
}));
vi.mock("@/server/ffmpeg/renderer", () => ({ renderVideo: mockRenderVideo }));
vi.mock("@/server/catalog/storage", () => ({ readCatalog: () => "" }));
vi.mock("@/server/catalog/parser", () => ({ parseCatalog: () => [], buildVideoMap: () => ({}) }));
vi.mock("@/server/sync/r2/hydrate-voiceover", () => ({ hydrateVoiceoverFromR2: vi.fn(async () => {}) }));
vi.mock("@/server/jobs/render-media", () => ({
  prepareRenderMedia: vi.fn(async () => ({ timeline: [], videoMap: {}, cleanup: vi.fn(async () => {}) })),
}));
vi.mock("@/server/pipeline/validator", () => ({ sortTimelineForRender: vi.fn() }));
vi.mock("@/server/runtime/paths", () => ({
  getRuntimePaths: () => ({ uploadsDir: "/tmp/up", outputsDir: "/tmp/out" }),
}));

async function importWorker() {
  vi.resetModules();
  return import("@/server/jobs/worker");
}

const flush = () => new Promise((r) => setImmediate(r));

beforeEach(() => {
  renderOpts = undefined;
  mockRenderVideo.mockClear();
  mockUpdateJob.mockReset();
  mockGetJob.mockReset();
  mockMarkJobCompleted.mockReset();
  mockMarkRenderFailed.mockReset();
  mockGetJob.mockReturnValue({ job_id: "j1", status: "queued", audio_filename: "a.mp3" });
});

afterEach(() => vi.useRealTimers());

describe("runJob progress wiring", () => {
  it("passes { jobId, onProgress } to renderVideo (so Cancel can kill ffmpeg)", async () => {
    const worker = await importWorker();
    worker.enqueueJob("j1");
    await flush();
    await flush();

    expect(mockRenderVideo).toHaveBeenCalledTimes(1);
    expect(renderOpts?.jobId).toBe("j1");
    expect(typeof renderOpts?.onProgress).toBe("function");
    expect(mockMarkJobCompleted).toHaveBeenCalledWith("j1", "forecast_j1.mp4");
  });

  it("throttles progress writes (≤1/s or ≥5% jump) and skips the R2 mirror", async () => {
    const worker = await importWorker();
    worker.enqueueJob("j1");
    await flush();
    await flush();

    const progressWrites = () =>
      mockUpdateJob.mock.calls.filter((c) => c[1] && typeof c[1] === "object" && "progress" in c[1]);

    const onProgress = renderOpts!.onProgress!;
    // Ten rapid tiny updates in the same tick → only the first lands.
    for (let i = 0; i < 10; i++) onProgress(0.01);
    expect(progressWrites()).toHaveLength(1);

    // A ≥5% jump bypasses the time gate → one more write.
    onProgress(0.5);
    const writes = progressWrites();
    expect(writes).toHaveLength(2);
    // Progress writes are mirror:false (ephemeral — no R2 mirror op).
    expect(writes[1][1]).toMatchObject({ progress: 0.5 });
    expect(writes[1][2]).toEqual({ mirror: false });
  });
});
