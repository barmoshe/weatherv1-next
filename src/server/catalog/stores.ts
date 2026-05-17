import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import lockfile from "proper-lockfile";
import type { Catalog } from "@/shared/types";
import { CatalogSchema } from "@/shared/types";
import { getAssetSource } from "@/server/assets/source";

export interface CatalogStoreStatus {
  kind: "local";
  enabled: false;
  ready: boolean;
}

export interface CatalogStore {
  readonly kind: "local";
  getCatalogPath(): string;
  read(): Catalog;
  write(catalog: Catalog): Promise<void>;
  version(): string;
  status(): CatalogStoreStatus;
}

function emptyCatalog(): Catalog {
  return { videos: [], updated_at: new Date().toISOString() };
}

function parseCatalogJson(raw: string): Catalog {
  return CatalogSchema.parse(JSON.parse(raw));
}

export function catalogJson(catalog: Catalog): string {
  return JSON.stringify({ ...catalog, updated_at: new Date().toISOString() }, null, 2);
}

export function catalogHash(catalog: Catalog): string {
  return createHash("sha1").update(catalogJson(catalog)).digest("hex");
}

function shaVersion(raw: string): string {
  return createHash("sha1").update(raw).digest("hex").slice(0, 8);
}

export class LocalCatalogStore implements CatalogStore {
  readonly kind = "local" as const;
  private versionCache: { mtimeMs: number; version: string } | null = null;

  getCatalogPath(): string {
    return getAssetSource().getCatalogPath();
  }

  read(): Catalog {
    const catalogPath = this.getCatalogPath();
    if (!fs.existsSync(catalogPath)) {
      fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
      fs.writeFileSync(catalogPath, catalogJson(emptyCatalog()), "utf8");
    }
    return parseCatalogJson(fs.readFileSync(catalogPath, "utf8"));
  }

  async write(catalog: Catalog): Promise<void> {
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
    this.versionCache = null;
  }

  version(): string {
    const catalogPath = this.getCatalogPath();
    let mtimeMs: number;
    try {
      mtimeMs = fs.statSync(catalogPath).mtimeMs;
    } catch {
      return "unknown";
    }
    if (this.versionCache && this.versionCache.mtimeMs === mtimeMs) {
      return this.versionCache.version;
    }
    try {
      const version = shaVersion(fs.readFileSync(catalogPath, "utf8"));
      this.versionCache = { mtimeMs, version };
      return version;
    } catch {
      return "unknown";
    }
  }

  status(): CatalogStoreStatus {
    return { kind: "local", enabled: false, ready: fs.existsSync(this.getCatalogPath()) };
  }
}

let cachedStore: CatalogStore | null = null;

export function getCatalogStore(): CatalogStore {
  cachedStore ??= new LocalCatalogStore();
  return cachedStore;
}

export function resetCatalogStoreForTests(): void {
  cachedStore = null;
}
