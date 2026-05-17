// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

async function importState() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  return await import("@/server/sync/r2/state");
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-r2-state-"));
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

describe("r2-state", () => {
  it("statePath() resolves to <runtimeDir>/r2-sync-state.json by default", async () => {
    const { statePath } = await importState();
    expect(statePath()).toBe(path.join(tempDir, "r2-sync-state.json"));
  });

  it("readR2SyncState() returns empty state when file is missing", async () => {
    const { readR2SyncState } = await importState();
    expect(readR2SyncState()).toEqual({});
  });

  it("readR2SyncState() parses a valid state file", async () => {
    fs.writeFileSync(
      path.join(tempDir, "r2-sync-state.json"),
      JSON.stringify({
        lastCatalogEtag: "etag-1",
        lastSyncAt: "2026-05-17T12:00:00.000Z",
      }),
    );
    const { readR2SyncState } = await importState();
    expect(readR2SyncState()).toMatchObject({
      lastCatalogEtag: "etag-1",
      lastSyncAt: "2026-05-17T12:00:00.000Z",
    });
  });

  it("readR2SyncState() falls back to empty state on invalid JSON", async () => {
    fs.writeFileSync(path.join(tempDir, "r2-sync-state.json"), "not json {{");
    const { readR2SyncState } = await importState();
    expect(readR2SyncState()).toEqual({});
  });

  it("patchR2SyncState() mutates and persists", async () => {
    const { patchR2SyncState, readR2SyncState } = await importState();
    await patchR2SyncState((s) => ({ ...s, lastCatalogEtag: "new-etag" }));
    expect(readR2SyncState().lastCatalogEtag).toBe("new-etag");
  });

  it("patchR2SyncState() serializes concurrent mutations via the lock", async () => {
    const { patchR2SyncState, readR2SyncState } = await importState();
    // Two parallel patches must both land — proper-lockfile serializes them.
    await Promise.all([
      patchR2SyncState((s) => ({ ...s, lastCatalogEtag: "etag-A" })),
      patchR2SyncState((s) => ({ ...s, lastSyncAt: "2026-05-17T00:00:00.000Z" })),
    ]);
    const final = readR2SyncState();
    expect(final.lastCatalogEtag).toBe("etag-A");
    expect(final.lastSyncAt).toBe("2026-05-17T00:00:00.000Z");
  });

  it("writeR2SyncState() wholesale replaces state atomically", async () => {
    const { writeR2SyncState, patchR2SyncState, readR2SyncState } = await importState();
    await patchR2SyncState((s) => ({ ...s, lastCatalogEtag: "old", lastSyncAt: "t" }));
    await writeR2SyncState({ lastCatalogEtag: "fresh" });
    const final = readR2SyncState();
    expect(final.lastCatalogEtag).toBe("fresh");
    expect(final.lastSyncAt).toBeUndefined();
  });

  it("patchObjectProgress() updates the keyed entry without disturbing siblings", async () => {
    const { patchObjectProgress, patchR2SyncState, readR2SyncState } = await importState();
    await patchR2SyncState((s) => ({
      ...s,
      objects: {
        "tenants/t/videos/keep.mp4": {
          key: "tenants/t/videos/keep.mp4",
          status: "synced",
          updatedAt: "2026-01-01T00:00:00.000Z",
          loaded: 100,
          total: 100,
        },
      },
    }));

    await patchObjectProgress("tenants/t/videos/new.mp4", {
      status: "uploading",
      loaded: 50,
      total: 200,
    });

    const objects = readR2SyncState().objects ?? {};
    expect(Object.keys(objects).sort()).toEqual([
      "tenants/t/videos/keep.mp4",
      "tenants/t/videos/new.mp4",
    ]);
    expect(objects["tenants/t/videos/keep.mp4"]?.status).toBe("synced");
    expect(objects["tenants/t/videos/new.mp4"]).toMatchObject({
      key: "tenants/t/videos/new.mp4",
      status: "uploading",
      loaded: 50,
      total: 200,
    });
  });

  it("patchObjectProgress() seeds a new entry with status=uploading by default", async () => {
    const { patchObjectProgress, readR2SyncState } = await importState();
    await patchObjectProgress("tenants/t/videos/x.mp4", { loaded: 5, total: 100 });
    const entry = readR2SyncState().objects?.["tenants/t/videos/x.mp4"];
    expect(entry).toBeDefined();
    expect(entry?.status).toBe("uploading");
    expect(entry?.loaded).toBe(5);
  });

  it("statePath() honors the R2_STATE_PATH override", async () => {
    const overridePath = path.join(tempDir, "custom-state.json");
    process.env.R2_STATE_PATH = overridePath;
    try {
      const { statePath } = await importState();
      expect(statePath()).toBe(overridePath);
    } finally {
      delete process.env.R2_STATE_PATH;
    }
  });
});
