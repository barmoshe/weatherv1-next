// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

// getJob returns undefined so the drain loop skips every job and empties the
// queue harmlessly — we only care about queuePosition reading the live array.
vi.mock("@/server/jobs/store", () => ({
  getJob: vi.fn(() => undefined),
  updateJob: vi.fn(),
  updateJobLocalOnly: vi.fn(),
  crashRecoverySweep: vi.fn(),
  getAllJobs: vi.fn(() => []),
}));
vi.mock("@/server/jobs/failure", () => ({ markJobCompleted: vi.fn(), markRenderFailed: vi.fn() }));
vi.mock("@/server/jobs/plan-bundle", () => ({ readPlanBundle: vi.fn(() => ({})), updatePlanBundle: vi.fn() }));
vi.mock("@/server/ffmpeg/renderer", () => ({ renderVideo: vi.fn(async () => true) }));
vi.mock("@/server/catalog/storage", () => ({ readCatalog: () => "" }));
vi.mock("@/server/catalog/parser", () => ({ parseCatalog: () => [], buildVideoMap: () => ({}) }));
vi.mock("@/server/sync/r2/hydrate-voiceover", () => ({ hydrateVoiceoverFromR2: vi.fn(async () => {}) }));
vi.mock("@/server/jobs/render-media", () => ({ prepareRenderMedia: vi.fn() }));
vi.mock("@/server/pipeline/validator", () => ({ sortTimelineForRender: vi.fn() }));
vi.mock("@/server/runtime/paths", () => ({
  getRuntimePaths: () => ({ uploadsDir: "/tmp/up", outputsDir: "/tmp/out" }),
}));

async function importWorker() {
  vi.resetModules();
  return import("@/server/jobs/worker");
}

beforeEach(() => vi.clearAllMocks());

describe("queuePosition", () => {
  it("returns 1-based positions for queued jobs, null otherwise", async () => {
    const worker = await importWorker();
    // Check synchronously, before the setImmediate-scheduled drain fires.
    worker.enqueueJob("a");
    worker.enqueueJob("b");
    worker.enqueueJob("c");

    expect(worker.queuePosition("a")).toBe(1);
    expect(worker.queuePosition("b")).toBe(2);
    expect(worker.queuePosition("c")).toBe(3);
    expect(worker.queuePosition("missing")).toBeNull();
  });
});
