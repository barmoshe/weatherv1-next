import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import lockfile from "proper-lockfile";
import type { Catalog } from "@/shared/types";
import { CatalogSchema } from "@/shared/types";

// Catalog lives at v1Drive/weather/notouch!/catalog.json relative to the repo root.
// The Next.js project is at weatherV1/weatherV1-next/, so the catalog is two levels up
// from process.cwd() when running from weatherV1-next/.
export const CATALOG_PATH = path.resolve(
  process.cwd(),
  "..",
  "v1Drive",
  "weather",
  "notouch!",
  "catalog.json"
);

export const VIDEOS_DIR = path.resolve(
  process.cwd(),
  "..",
  "v1Drive",
  "weather",
  "videos"
);

let _catalogCache: { catalog: Catalog; mtime: number } | null = null;

export function readCatalog(): Catalog {
  const stat = fs.statSync(CATALOG_PATH);
  if (_catalogCache && _catalogCache.mtime === stat.mtimeMs) {
    return _catalogCache.catalog;
  }
  const raw = fs.readFileSync(CATALOG_PATH, "utf8");
  const parsed = CatalogSchema.parse(JSON.parse(raw));
  _catalogCache = { catalog: parsed, mtime: stat.mtimeMs };
  return parsed;
}

export function invalidateCatalogCache(): void {
  _catalogCache = null;
}

export function catalogVersion(): string {
  try {
    const raw = fs.readFileSync(CATALOG_PATH, "utf8");
    return createHash("sha1").update(raw).digest("hex").slice(0, 8);
  } catch {
    return "unknown";
  }
}

export async function writeCatalog(catalog: Catalog): Promise<void> {
  // Ensure the directory exists
  fs.mkdirSync(path.dirname(CATALOG_PATH), { recursive: true });

  let release: (() => Promise<void>) | null = null;
  try {
    release = await lockfile.lock(CATALOG_PATH, { retries: 5 });
    const tmp = `${CATALOG_PATH}.tmp.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(catalog, null, 2), "utf8");
    fs.renameSync(tmp, CATALOG_PATH);
    invalidateCatalogCache();
  } finally {
    if (release) await release();
  }
}
