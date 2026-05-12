import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "@/shared/types";
import { resetRuntimeConfigForTests } from "@/server/runtime/config";
import { resetAssetSourceForTests } from "@/server/assets/source";
import { LocalCatalogStore } from "@/server/catalog/stores";
import { parseCatalog } from "@/server/catalog/parser";

const ENV_KEYS = ["WEATHER_WORKSPACE_DIR", "WEATHER_RUNTIME_DIR"] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDirs: string[] = [];

function makeTempDir(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `weatherv1-${name}-`));
  tempDirs.push(dir);
  return dir;
}

function resetRuntimeState() {
  resetRuntimeConfigForTests();
  resetAssetSourceForTests();
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetRuntimeState();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRuntimeState();
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("catalog stores", () => {
  it("persists catalog JSON through the local store", async () => {
    const workspace = makeTempDir("local-catalog");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    const store = new LocalCatalogStore();
    const catalog: Catalog = { videos: [], updated_at: "2026-05-12T00:00:00.000Z" };
    await store.write(catalog);

    expect(store.read().videos).toEqual(catalog.videos);
    expect(store.read().updated_at).toEqual(expect.any(String));
    expect(store.status()).toMatchObject({ kind: "local", ready: true });
  });

  it("scaffolds an empty catalog when the file is missing", () => {
    const workspace = makeTempDir("local-catalog-missing");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    const store = new LocalCatalogStore();
    expect(store.read()).toMatchObject({ videos: [] });
    expect(fs.existsSync(path.join(workspace, "notouch!", "catalog.json"))).toBe(true);
  });

  it("keeps remote-only catalog rows visible for R2 materialization", async () => {
    const workspace = makeTempDir("remote-only-catalog");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    const store = new LocalCatalogStore();
    await store.write({
      videos: [{
        id: "vid_001",
        filename: "one.mp4",
        description: "",
        duration_sec: 3,
        orientation: "V",
        source: "original",
        segments: [],
        remote: { key: "tenants/default/videos/vid_001/one.mp4", status: "cloud_only" },
      }],
    });

    const parsed = parseCatalog(store.read(), path.join(workspace, "videos"));
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toMatchObject({ id: "vid_001", availability: "cloud_only" });
  });
});
