// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const putR2Text = vi.fn<(key: string, body: string) => Promise<{ etag?: string }>>();

vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => true,
  tenantKey: (k: string) => `tenants/test/${k}`,
  putR2Text,
}));

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

async function importFresh() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  return {
    queue: await import("@/server/sync/r2/mirror-queue"),
    state: await import("@/server/sync/r2/state"),
  };
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-mirror-queue-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_RUNTIME_DIR = tempDir;
  putR2Text.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

function writeJobsFile(dir: string, body: object): void {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "jobs.json"), JSON.stringify(body, null, 2));
}

describe("mirror-queue", () => {
  it("enqueue → success removes op from state", async () => {
    const { queue, state } = await importFresh();
    writeJobsFile(tempDir, { j1: { job_id: "j1", status: "queued" } });

    putR2Text.mockResolvedValueOnce({ etag: "abc" });
    await queue.enqueueMirror({ kind: "jobs", key: "tenants/test/jobs/jobs.json" });
    await queue._drainOnceForTests();

    expect(putR2Text).toHaveBeenCalledTimes(1);
    expect(state.readR2SyncState().mirrors ?? []).toEqual([]);
  });

  it("coalesces multiple enqueues for the same key", async () => {
    const { queue, state } = await importFresh();
    await queue.enqueueMirror({ kind: "jobs", key: "tenants/test/jobs/jobs.json" });
    await queue.enqueueMirror({ kind: "jobs", key: "tenants/test/jobs/jobs.json" });
    await queue.enqueueMirror({ kind: "jobs", key: "tenants/test/jobs/jobs.json" });

    const mirrors = state.readR2SyncState().mirrors ?? [];
    expect(mirrors).toHaveLength(1);
  });

  it("failure increments attempts and schedules a retry", async () => {
    const { queue, state } = await importFresh();
    writeJobsFile(tempDir, { j1: { job_id: "j1", status: "queued" } });

    putR2Text.mockRejectedValueOnce(new Error("network down"));
    await queue.enqueueMirror({ kind: "jobs", key: "tenants/test/jobs/jobs.json" });
    await queue._drainOnceForTests();

    const mirrors = state.readR2SyncState().mirrors ?? [];
    expect(mirrors).toHaveLength(1);
    expect(mirrors[0]?.attempts).toBe(1);
    expect(mirrors[0]?.lastError).toBe("network down");
    expect(mirrors[0]?.nextAttemptAt).toBeDefined();
    expect(mirrors[0]?.dead).toBeFalsy();
    expect(state.readR2SyncState().lastMirrorError).toBe("network down");
  });

  it("dead-letters after MAX_ATTEMPTS and reviveDeadMirrorOps resets", async () => {
    const { queue, state } = await importFresh();
    writeJobsFile(tempDir, { j1: { job_id: "j1", status: "queued" } });

    // Pre-seed the op as nearly dead (one attempt away from MAX).
    await state.patchR2SyncState((s) => ({
      ...s,
      mirrors: [{
        id: "op-x",
        kind: "jobs",
        key: "tenants/test/jobs/jobs.json",
        enqueuedAt: new Date().toISOString(),
        attempts: 7, // MAX_ATTEMPTS - 1
      }],
    }));
    putR2Text.mockRejectedValueOnce(new Error("still down"));
    await queue._drainOnceForTests();

    let mirrors = state.readR2SyncState().mirrors ?? [];
    expect(mirrors[0]?.dead).toBe(true);
    expect(mirrors[0]?.attempts).toBe(8);
    expect(queue.getMirrorQueueCounts()).toMatchObject({ pending: 0, dead: 1 });

    const revived = await queue.reviveDeadMirrorOps();
    expect(revived).toBe(1);
    mirrors = state.readR2SyncState().mirrors ?? [];
    expect(mirrors[0]?.dead).toBeFalsy();
    expect(mirrors[0]?.attempts).toBe(0);
  });

  it("drops op when source file is missing", async () => {
    const { queue, state } = await importFresh();
    // Don't write jobs.json — payload load returns null.
    await queue.enqueueMirror({ kind: "jobs", key: "tenants/test/jobs/jobs.json" });
    await queue._drainOnceForTests();

    expect(putR2Text).not.toHaveBeenCalled();
    expect(state.readR2SyncState().mirrors ?? []).toEqual([]);
  });
});
