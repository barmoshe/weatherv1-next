import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import lockfile from "proper-lockfile";
import type { Catalog } from "@/shared/types";
import { CatalogSchema } from "@/shared/types";
import { getAssetSource } from "@/server/assets/source";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import {
  type DriveCatalogClient,
  type DriveFileMetadata,
  GoogleDriveRestClient,
} from "./google-drive-client";

const DRIVE_ROOT_FOLDER_NAME = "WeatherV1";
const DRIVE_CATALOG_FILE_NAME = "catalog.json";

export interface CatalogStoreStatus {
  kind: "local" | "google-drive";
  enabled: boolean;
  ready: boolean;
  rootFolderId?: string;
  catalogFileId?: string;
  lastKnownModifiedTime?: string;
  lastKnownMd5Checksum?: string;
  lastSyncAt?: string;
  error?: string;
}

export interface CatalogStore {
  readonly kind: "local" | "google-drive";
  getCatalogPath(): string;
  read(): Catalog;
  write(catalog: Catalog): Promise<void>;
  version(): string;
  status(): CatalogStoreStatus;
  pullRemoteToLocal?(): Promise<CatalogStoreStatus>;
}

export class CatalogConflictError extends Error {
  constructor(message = "remote catalog changed; pull latest or replace remote") {
    super(message);
    this.name = "CatalogConflictError";
  }
}

export interface DriveCatalogState {
  rootFolderId?: string;
  catalogFileId?: string;
  lastKnownModifiedTime?: string;
  lastKnownMd5Checksum?: string;
  lastSyncAt?: string;
}

function emptyCatalog(): Catalog {
  return { videos: [], updated_at: new Date().toISOString() };
}

function parseCatalogJson(raw: string): Catalog {
  return CatalogSchema.parse(JSON.parse(raw));
}

function catalogJson(catalog: Catalog): string {
  return JSON.stringify(catalog, null, 2);
}

function shaVersion(raw: string): string {
  return createHash("sha1").update(raw).digest("hex").slice(0, 8);
}

function sameRemote(remote: DriveFileMetadata, state: DriveCatalogState): boolean {
  if (!state.lastKnownModifiedTime && !state.lastKnownMd5Checksum) return true;
  if (state.lastKnownMd5Checksum && remote.md5Checksum) {
    return state.lastKnownMd5Checksum === remote.md5Checksum;
  }
  if (state.lastKnownModifiedTime && remote.modifiedTime) {
    return state.lastKnownModifiedTime === remote.modifiedTime;
  }
  return true;
}

export class LocalCatalogStore implements CatalogStore {
  readonly kind = "local";

  getCatalogPath(): string {
    return getAssetSource().getCatalogPath();
  }

  read(): Catalog {
    const catalogPath = this.getCatalogPath();
    const raw = fs.readFileSync(catalogPath, "utf8");
    return parseCatalogJson(raw);
  }

  async write(catalog: Catalog): Promise<void> {
    await this.writeWithLock(catalog);
  }

  async writeWithLock(catalog: Catalog): Promise<void> {
    const catalogPath = this.getCatalogPath();
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    if (!fs.existsSync(catalogPath)) {
      fs.writeFileSync(catalogPath, catalogJson(emptyCatalog()), "utf8");
    }

    let release: (() => Promise<void>) | null = null;
    try {
      release = await lockfile.lock(catalogPath, { retries: 5 });
      const tmp = `${catalogPath}.tmp.${process.pid}`;
      fs.writeFileSync(tmp, catalogJson(catalog), "utf8");
      fs.renameSync(tmp, catalogPath);
    } finally {
      if (release) await release();
    }
  }

  version(): string {
    try {
      return shaVersion(fs.readFileSync(this.getCatalogPath(), "utf8"));
    } catch {
      return "unknown";
    }
  }

  status(): CatalogStoreStatus {
    return { kind: "local", enabled: false, ready: fs.existsSync(this.getCatalogPath()) };
  }
}

export class GoogleDriveCatalogStore implements CatalogStore {
  readonly kind = "google-drive";
  private readonly localStore: LocalCatalogStore;
  private readonly client: DriveCatalogClient;
  private readonly statePath: string;

  constructor(args: {
    localStore?: LocalCatalogStore;
    client?: DriveCatalogClient;
    statePath?: string;
  } = {}) {
    const cfg = getRuntimeConfig();
    const runtime = getRuntimePaths();
    this.localStore = args.localStore ?? new LocalCatalogStore();
    this.client =
      args.client ??
      new GoogleDriveRestClient({
        clientId: cfg.googleDrive.clientId,
        clientSecret: cfg.googleDrive.clientSecret,
        refreshToken: cfg.googleDrive.refreshToken,
        accessToken: cfg.googleDrive.accessToken,
      });
    this.statePath =
      args.statePath ??
      cfg.googleDrive.statePath ??
      path.join(runtime.runtimeDir, "google-drive-catalog-state.json");
  }

  getCatalogPath(): string {
    return this.localStore.getCatalogPath();
  }

  read(): Catalog {
    return this.localStore.read();
  }

  async write(catalog: Catalog): Promise<void> {
    const remote = await this.ensureRemoteCatalog();
    if (!sameRemote(remote.metadata, remote.state)) {
      throw new CatalogConflictError();
    }

    const content = catalogJson(catalog);
    await this.localStore.writeWithLock(catalog);
    const metadata = await this.client.updateTextFile(remote.catalogFileId, content);
    this.writeState({
      ...remote.state,
      catalogFileId: remote.catalogFileId,
      rootFolderId: remote.rootFolderId,
      lastKnownModifiedTime: metadata.modifiedTime,
      lastKnownMd5Checksum: metadata.md5Checksum,
      lastSyncAt: new Date().toISOString(),
    });
  }

  version(): string {
    return this.localStore.version();
  }

  status(): CatalogStoreStatus {
    const state = this.readState();
    return {
      kind: "google-drive",
      enabled: true,
      ready: Boolean(state.catalogFileId),
      ...state,
    };
  }

  async pullRemoteToLocal(): Promise<CatalogStoreStatus> {
    const remote = await this.ensureRemoteCatalog();
    const raw = await this.client.downloadText(remote.catalogFileId);
    const catalog = parseCatalogJson(raw);
    await this.localStore.writeWithLock(catalog);
    this.writeState({
      ...remote.state,
      rootFolderId: remote.rootFolderId,
      catalogFileId: remote.catalogFileId,
      lastKnownModifiedTime: remote.metadata.modifiedTime,
      lastKnownMd5Checksum: remote.metadata.md5Checksum,
      lastSyncAt: new Date().toISOString(),
    });
    return this.status();
  }

  private async ensureRemoteCatalog(): Promise<{
    rootFolderId: string;
    catalogFileId: string;
    metadata: DriveFileMetadata;
    state: DriveCatalogState;
  }> {
    const cfg = getRuntimeConfig();
    const savedState = this.readState();
    const state = {
      ...savedState,
      rootFolderId: savedState.rootFolderId ?? cfg.googleDrive.rootFolderId,
      catalogFileId: savedState.catalogFileId ?? cfg.googleDrive.catalogFileId,
    };

    let rootFolderId = state.rootFolderId;
    if (!rootFolderId) {
      const existing = await this.client.findFolderByName("root", DRIVE_ROOT_FOLDER_NAME);
      const folder = existing ?? (await this.client.createFolder("root", DRIVE_ROOT_FOLDER_NAME));
      rootFolderId = folder.id;
    }

    let catalogFileId = state.catalogFileId;
    let metadata: DriveFileMetadata | null = null;
    if (catalogFileId) {
      metadata = await this.client.getFile(catalogFileId);
    } else {
      const existing = await this.client.findFileByName(rootFolderId, DRIVE_CATALOG_FILE_NAME);
      if (existing) {
        catalogFileId = existing.id;
        metadata = existing;
      } else {
        const localCatalog = this.localCatalogOrEmpty();
        metadata = await this.client.createTextFile(
          rootFolderId,
          DRIVE_CATALOG_FILE_NAME,
          catalogJson(localCatalog),
        );
        catalogFileId = metadata.id;
      }
    }

    const nextState = {
      ...state,
      rootFolderId,
      catalogFileId,
      lastKnownModifiedTime: state.lastKnownModifiedTime ?? metadata.modifiedTime,
      lastKnownMd5Checksum: state.lastKnownMd5Checksum ?? metadata.md5Checksum,
    };
    this.writeState(nextState);

    return { rootFolderId, catalogFileId, metadata, state: nextState };
  }

  private localCatalogOrEmpty(): Catalog {
    try {
      return this.localStore.read();
    } catch {
      return emptyCatalog();
    }
  }

  private readState(): DriveCatalogState {
    try {
      if (!fs.existsSync(this.statePath)) return {};
      return JSON.parse(fs.readFileSync(this.statePath, "utf8")) as DriveCatalogState;
    } catch {
      return {};
    }
  }

  private writeState(state: DriveCatalogState): void {
    fs.mkdirSync(path.dirname(this.statePath), { recursive: true });
    const tmp = `${this.statePath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
    fs.renameSync(tmp, this.statePath);
  }
}

let cachedStore: CatalogStore | null = null;

export function getCatalogStore(): CatalogStore {
  if (cachedStore) return cachedStore;
  const cfg = getRuntimeConfig();
  cachedStore = cfg.googleDrive.enabled ? new GoogleDriveCatalogStore() : new LocalCatalogStore();
  return cachedStore;
}

export function resetCatalogStoreForTests(): void {
  cachedStore = null;
}
