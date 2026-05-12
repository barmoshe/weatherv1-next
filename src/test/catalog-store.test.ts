import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Catalog } from "@/shared/types";
import { resetRuntimeConfigForTests } from "@/server/runtime/config";
import { resetAssetSourceForTests } from "@/server/assets/source";
import { GoogleDriveCatalogStore, LocalCatalogStore, type DriveCatalogState } from "@/server/catalog/stores";
import type { DriveCatalogClient, DriveFileMetadata } from "@/server/catalog/google-drive-client";

const ENV_KEYS = [
  "WEATHER_WORKSPACE_DIR",
  "WEATHER_RUNTIME_DIR",
  "GOOGLE_DRIVE_CATALOG",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_REFRESH_TOKEN",
  "GOOGLE_DRIVE_STATE_PATH",
] as const;

class FakeDriveClient implements DriveCatalogClient {
  rootFolder: DriveFileMetadata | null = null;
  catalogFile: DriveFileMetadata | null = null;
  content = "";
  updates = 0;

  async findFolderByName(): Promise<DriveFileMetadata | null> {
    return this.rootFolder;
  }

  async createFolder(): Promise<DriveFileMetadata> {
    this.rootFolder = { id: "folder-1", name: "WeatherV1", mimeType: "application/vnd.google-apps.folder" };
    return this.rootFolder;
  }

  async findFileByName(): Promise<DriveFileMetadata | null> {
    return this.catalogFile;
  }

  async getFile(): Promise<DriveFileMetadata> {
    if (!this.catalogFile) throw new Error("missing file");
    return this.catalogFile;
  }

  async downloadText(): Promise<string> {
    return this.content;
  }

  async createTextFile(_parentId: string, _name: string, content: string): Promise<DriveFileMetadata> {
    this.content = content;
    this.catalogFile = {
      id: "catalog-1",
      name: "catalog.json",
      modifiedTime: "2026-05-12T00:00:00.000Z",
      md5Checksum: "md5-a",
    };
    return this.catalogFile;
  }

  async updateTextFile(_fileId: string, content: string): Promise<DriveFileMetadata> {
    this.updates += 1;
    this.content = content;
    this.catalogFile = {
      id: "catalog-1",
      name: "catalog.json",
      modifiedTime: `2026-05-12T00:00:0${this.updates}.000Z`,
      md5Checksum: `md5-update-${this.updates}`,
    };
    return this.catalogFile;
  }
}

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

function readJson<T>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8")) as T;
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

    expect(store.read()).toEqual(catalog);
    expect(store.status()).toMatchObject({ kind: "local", ready: true });
  });

  it("creates the Drive folder/catalog and pushes local catalog updates", async () => {
    const workspace = makeTempDir("drive-catalog");
    const statePath = path.join(makeTempDir("drive-state"), "state.json");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    const fakeDrive = new FakeDriveClient();
    const store = new GoogleDriveCatalogStore({ client: fakeDrive, statePath });
    const catalog: Catalog = {
      videos: [{
        id: "vid_001",
        filename: "one.mp4",
        description: "",
        duration_sec: 3,
        orientation: "V",
        source: "original",
        segments: [],
      }],
    };

    await store.write(catalog);

    expect(fakeDrive.rootFolder?.id).toBe("folder-1");
    expect(fakeDrive.catalogFile?.id).toBe("catalog-1");
    expect(JSON.parse(fakeDrive.content)).toMatchObject({ videos: [{ id: "vid_001" }] });
    expect(store.read()).toMatchObject({ videos: [{ id: "vid_001" }] });
    expect(readJson<DriveCatalogState>(statePath)).toMatchObject({
      rootFolderId: "folder-1",
      catalogFileId: "catalog-1",
      lastKnownMd5Checksum: "md5-update-1",
    });
  });

  it("blocks a Drive overwrite when the remote catalog changed", async () => {
    const workspace = makeTempDir("drive-conflict");
    const statePath = path.join(makeTempDir("drive-conflict-state"), "state.json");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(
      statePath,
      JSON.stringify({
        rootFolderId: "folder-1",
        catalogFileId: "catalog-1",
        lastKnownModifiedTime: "2026-05-12T00:00:00.000Z",
        lastKnownMd5Checksum: "md5-old",
      }),
      "utf8",
    );

    const fakeDrive = new FakeDriveClient();
    fakeDrive.rootFolder = { id: "folder-1" };
    fakeDrive.catalogFile = {
      id: "catalog-1",
      modifiedTime: "2026-05-12T00:00:01.000Z",
      md5Checksum: "md5-new",
    };
    const store = new GoogleDriveCatalogStore({ client: fakeDrive, statePath });

    await expect(store.write({ videos: [] })).rejects.toMatchObject({
      name: "CatalogConflictError",
    });
    expect(fakeDrive.updates).toBe(0);
  });
});
