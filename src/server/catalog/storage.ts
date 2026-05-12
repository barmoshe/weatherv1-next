import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import lockfile from "proper-lockfile";
import type { Catalog } from "@/shared/types";
import { CatalogSchema } from "@/shared/types";
import { getAssetSource } from "@/server/assets/source";

export function getCatalogPath(): string {
  return getAssetSource().getCatalogPath();
}

export function getVideosDir(): string {
  return getAssetSource().getVideosDir();
}

let _catalogCache: { catalog: Catalog; mtime: number } | null = null;

export function readCatalog(): Catalog {
  const catalogPath = getCatalogPath();
  const stat = fs.statSync(catalogPath);
  if (_catalogCache && _catalogCache.mtime === stat.mtimeMs) {
    return _catalogCache.catalog;
  }
  const raw = fs.readFileSync(catalogPath, "utf8");
  const parsed = CatalogSchema.parse(JSON.parse(raw));
  _catalogCache = { catalog: parsed, mtime: stat.mtimeMs };
  return parsed;
}

export function invalidateCatalogCache(): void {
  _catalogCache = null;
}

export function catalogVersion(): string {
  try {
    const raw = fs.readFileSync(getCatalogPath(), "utf8");
    return createHash("sha1").update(raw).digest("hex").slice(0, 8);
  } catch {
    return "unknown";
  }
}

export async function writeCatalog(catalog: Catalog): Promise<void> {
  const catalogPath = getCatalogPath();
  // Ensure the directory exists
  fs.mkdirSync(path.dirname(catalogPath), { recursive: true });

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(catalogPath, { retries: 5 });
    const tmp = `${catalogPath}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2), "utf8");
    fs.renameSync(tmp, catalogPath);
    invalidateCatalogCache();
  } finally {
    if (release) await release();
  }
}
