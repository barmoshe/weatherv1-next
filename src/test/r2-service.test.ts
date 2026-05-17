// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Catalog } from "@/shared/types";

const ENV_KEYS = [
  "WEATHER_WORKSPACE_DIR",
  "WEATHER_RUNTIME_DIR",
  "R2_SYNC_ENABLED",
  "R2_GATEWAY_URL",
  "R2_TENANT_ID",
  "R2_APP_USERNAME",
  "R2_APP_PASSWORD",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDir: string;

// Hoisted mocks so vi.mock can reference them before module load.
const mocks = vi.hoisted(() => ({
  headR2Object: vi.fn(),
  getR2Text: vi.fn(),
  putR2Text: vi.fn(),
  uploadR2File: vi.fn(),
  downloadR2File: vi.fn(),
}));

vi.mock("@/server/sync/r2/client", () => ({
  r2Configured: () => true,
  tenantKey: (k: string) => `tenants/tenant-x/${k}`,
  headR2Object: mocks.headR2Object,
  getR2Text: mocks.getR2Text,
  putR2Text: mocks.putR2Text,
  uploadR2File: mocks.uploadR2File,
  downloadR2File: mocks.downloadR2File,
}));

// Mirror queue counts; service.getR2SyncStatus reads this.
vi.mock("@/server/sync/r2/mirror-queue", () => ({
  getMirrorQueueCounts: () => ({ pending: 0, dead: 0 }),
}));

// Posters not exercised in this suite.
vi.mock("@/server/ffmpeg/posters", () => ({
  generatePoster: vi.fn().mockResolvedValue(null),
  generateAt: vi.fn().mockResolvedValue(null),
}));

async function importFresh() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  const catalogStorage = await import("@/server/catalog/storage");
  catalogStorage.resetCatalogStorageForTests();
  const service = await import("@/server/sync/r2/service");
  service.resetR2AutoBootstrapForTests();
  service.resetR2JobsBootstrapForTests();
  const state = await import("@/server/sync/r2/state");
  return { service, catalogStorage, state };
}

function seedCatalog(catalog: Catalog): void {
  const catalogPath = path.join(tempDir, "notouch!", "catalog.json");
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
  fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2));
}

function readSeededCatalog(): Catalog {
  return JSON.parse(
    fs.readFileSync(path.join(tempDir, "notouch!", "catalog.json"), "utf8"),
  ) as Catalog;
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-r2-svc-"));
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  process.env.WEATHER_WORKSPACE_DIR = tempDir;
  process.env.WEATHER_RUNTIME_DIR = path.join(tempDir, "_runtime");
  process.env.R2_SYNC_ENABLED = "1";
  process.env.R2_GATEWAY_URL = "https://gateway.example/";
  process.env.R2_TENANT_ID = "tenant-x";
  process.env.R2_APP_USERNAME = "user";
  process.env.R2_APP_PASSWORD = "pw";

  for (const m of Object.values(mocks)) m.mockReset();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("R2CatalogConflictError", () => {
  it("is exported and has a sensible default message", async () => {
    const { service } = await importFresh();
    const err = new service.R2CatalogConflictError();
    expect(err.name).toBe("R2CatalogConflictError");
    expect(err.message).toMatch(/remote catalog changed/);
  });
});

describe("pullCatalogFromR2", () => {
  it("writes the remote catalog locally and updates state", async () => {
    seedCatalog({ videos: [], updated_at: "2026-01-01T00:00:00.000Z" });

    const remote: Catalog = {
      videos: [
        {
          id: "vid-1",
          filename: "vid-1.mp4",
          description: "",
          duration_sec: 0,
          orientation: "V",
          source: "original",
          segments: [],
        },
      ],
      updated_at: "2026-05-17T00:00:00.000Z",
    };
    mocks.getR2Text.mockResolvedValueOnce({
      text: JSON.stringify(remote),
      etag: "remote-etag",
    });

    const { service } = await importFresh();
    const status = await service.pullCatalogFromR2();

    expect(mocks.getR2Text).toHaveBeenCalledWith("tenants/tenant-x/catalog/catalog.json");
    expect(status.lastCatalogEtag).toBe("remote-etag");
    expect(readSeededCatalog().videos.map((v) => v.id)).toEqual(["vid-1"]);
  });
});

describe("pushCatalogToR2", () => {
  it("PUTs the catalog when remote is missing", async () => {
    seedCatalog({
      videos: [
        {
          id: "vid-1",
          filename: "vid-1.mp4",
          description: "",
          duration_sec: 0,
          orientation: "V",
          source: "original",
          segments: [],
        },
      ],
      updated_at: "2026-05-17T00:00:00.000Z",
    });
    mocks.headR2Object.mockResolvedValueOnce(null);
    mocks.putR2Text.mockResolvedValueOnce({ etag: "new-etag" });

    const { service } = await importFresh();
    const status = await service.pushCatalogToR2();

    expect(mocks.putR2Text).toHaveBeenCalledTimes(1);
    expect(status.lastCatalogEtag).toBe("new-etag");
  });

  it("throws R2CatalogConflictError when remote etag is unknown to us", async () => {
    seedCatalog({
      videos: [],
      updated_at: "2026-05-17T00:00:00.000Z",
    });
    mocks.headR2Object.mockResolvedValueOnce({ etag: "remote-other-etag" });

    const { service, state } = await importFresh();
    await expect(service.pushCatalogToR2()).rejects.toThrow(service.R2CatalogConflictError);
    expect(mocks.putR2Text).not.toHaveBeenCalled();
    expect(state.readR2SyncState().conflict?.remoteEtag).toBe("remote-other-etag");
  });

  it("PUTs when our recorded etag matches remote", async () => {
    seedCatalog({ videos: [], updated_at: "2026-05-17T00:00:00.000Z" });
    mocks.headR2Object.mockResolvedValueOnce({ etag: "match-etag" });
    mocks.putR2Text.mockResolvedValueOnce({ etag: "next-etag" });

    const { service, state } = await importFresh();
    await state.patchR2SyncState((s) => ({ ...s, lastCatalogEtag: "match-etag" }));

    const status = await service.pushCatalogToR2();
    expect(mocks.putR2Text).toHaveBeenCalledTimes(1);
    expect(status.lastCatalogEtag).toBe("next-etag");
  });
});

describe("replaceRemoteCatalog", () => {
  it("bypasses the conflict check and clears any existing conflict", async () => {
    seedCatalog({ videos: [], updated_at: "2026-05-17T00:00:00.000Z" });
    mocks.headR2Object.mockResolvedValueOnce({ etag: "different" });
    mocks.putR2Text.mockResolvedValueOnce({ etag: "replaced" });

    const { service, state } = await importFresh();
    await state.patchR2SyncState((s) => ({
      ...s,
      conflict: { remoteEtag: "x", localHash: "y", detectedAt: "z" },
    }));

    const status = await service.replaceRemoteCatalog();
    expect(mocks.putR2Text).toHaveBeenCalledTimes(1);
    expect(status.conflict).toBeUndefined();
    expect(state.readR2SyncState().conflict).toBeUndefined();
  });
});

describe("uploadVideoForEntry", () => {
  it("uploads the local video file and refreshes the catalog entry", async () => {
    const videosDir = path.join(tempDir, "videos");
    fs.mkdirSync(videosDir, { recursive: true });
    fs.writeFileSync(path.join(videosDir, "clip.mp4"), Buffer.alloc(32));

    seedCatalog({
      videos: [
        {
          id: "vid-1",
          filename: "clip.mp4",
          description: "",
          duration_sec: 0,
          orientation: "V",
          source: "original",
          segments: [],
        },
      ],
      updated_at: "2026-05-17T00:00:00.000Z",
    });

    mocks.uploadR2File.mockResolvedValueOnce({ etag: "uploaded-etag", size: 32 });
    mocks.headR2Object.mockResolvedValueOnce(null);
    mocks.putR2Text.mockResolvedValueOnce({ etag: "catalog-etag" });

    const { service } = await importFresh();
    await service.uploadVideoForEntry("vid-1");

    expect(mocks.uploadR2File).toHaveBeenCalledWith(
      "tenants/tenant-x/videos/vid-1/clip.mp4",
      path.join(videosDir, "clip.mp4"),
      "video/mp4",
      expect.any(Function),
    );

    const entry = readSeededCatalog().videos.find((v) => v.id === "vid-1");
    expect(entry?.remote?.status).toBe("local");
    expect(entry?.remote?.etag).toBe("uploaded-etag");
  });

  it("no-ops when the entry has no local file", async () => {
    seedCatalog({
      videos: [
        {
          id: "vid-missing",
          filename: "missing.mp4",
          description: "",
          duration_sec: 0,
          orientation: "V",
          source: "original",
          segments: [],
        },
      ],
      updated_at: "2026-05-17T00:00:00.000Z",
    });
    const { service } = await importFresh();
    await service.uploadVideoForEntry("vid-missing");
    expect(mocks.uploadR2File).not.toHaveBeenCalled();
  });
});

describe("materializeVideo", () => {
  it("downloads a cloud-only entry and flips its remote.status to local", async () => {
    const videosDir = path.join(tempDir, "videos");
    fs.mkdirSync(videosDir, { recursive: true });

    seedCatalog({
      videos: [
        {
          id: "vid-cloud",
          filename: "cloud.mp4",
          description: "",
          duration_sec: 0,
          orientation: "V",
          source: "original",
          segments: [],
          remote: {
            key: "tenants/tenant-x/videos/vid-cloud/cloud.mp4",
            status: "cloud_only",
          },
        },
      ],
      updated_at: "2026-05-17T00:00:00.000Z",
    });

    mocks.downloadR2File.mockImplementationOnce(
      async (_key: string, targetPath: string) => {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, Buffer.alloc(64));
        return { etag: "dl-etag", size: 64, updatedAt: "2026-05-17T01:00:00.000Z" };
      },
    );

    const { service } = await importFresh();
    const parsed = await service.materializeVideo("vid-cloud");

    expect(parsed.id).toBe("vid-cloud");
    expect(fs.existsSync(path.join(videosDir, "cloud.mp4"))).toBe(true);

    const entry = readSeededCatalog().videos.find((v) => v.id === "vid-cloud");
    expect(entry?.remote?.status).toBe("local");
    expect(entry?.remote?.etag).toBe("dl-etag");
  });

  it("throws when entry has no remote key", async () => {
    seedCatalog({
      videos: [
        {
          id: "vid-orphan",
          filename: "missing.mp4",
          description: "",
          duration_sec: 0,
          orientation: "V",
          source: "original",
          segments: [],
        },
      ],
      updated_at: "2026-05-17T00:00:00.000Z",
    });
    const { service } = await importFresh();
    await expect(service.materializeVideo("vid-orphan")).rejects.toThrow(/no R2 object key/);
  });

  it("throws on unknown id", async () => {
    seedCatalog({ videos: [], updated_at: "2026-05-17T00:00:00.000Z" });
    const { service } = await importFresh();
    await expect(service.materializeVideo("nope")).rejects.toThrow(/not found/);
  });
});

describe("uploadRuntimeFile", () => {
  it("uploads a file under tenants/<id>/<relativeKey>", async () => {
    const localFile = path.join(tempDir, "src.bin");
    fs.writeFileSync(localFile, Buffer.alloc(10));

    mocks.uploadR2File.mockResolvedValueOnce({ etag: "rt", size: 10 });

    const { service } = await importFresh();
    await service.uploadRuntimeFile("downloads/file.bin", localFile);
    expect(mocks.uploadR2File).toHaveBeenCalledWith(
      "tenants/tenant-x/downloads/file.bin",
      localFile,
      "application/octet-stream",
    );
  });

  it("silently skips when the local file is missing", async () => {
    const { service } = await importFresh();
    await service.uploadRuntimeFile("downloads/missing.bin", path.join(tempDir, "missing.bin"));
    expect(mocks.uploadR2File).not.toHaveBeenCalled();
  });
});
