import type { Catalog } from "@/shared/types";
import { getAssetSource } from "@/server/assets/source";
import {
  getCatalogStore,
  resetCatalogStoreForTests,
  type CatalogStoreStatus,
} from "./stores";

export function getCatalogPath(): string {
  return getCatalogStore().getCatalogPath();
}

export function getVideosDir(): string {
  return getAssetSource().getVideosDir();
}

let _catalogCache: { catalog: Catalog; version: string } | null = null;

export function readCatalog(): Catalog {
  const store = getCatalogStore();
  const version = store.version();
  if (_catalogCache && _catalogCache.version === version) {
    return _catalogCache.catalog;
  }
  const parsed = store.read();
  _catalogCache = { catalog: parsed, version };
  return parsed;
}

export function invalidateCatalogCache(): void {
  _catalogCache = null;
}

export function resetCatalogStorageForTests(): void {
  invalidateCatalogCache();
  resetCatalogStoreForTests();
}

export function catalogVersion(): string {
  return getCatalogStore().version();
}

export function catalogStoreStatus(): CatalogStoreStatus {
  return getCatalogStore().status();
}

export async function pullCatalogFromDrive(): Promise<CatalogStoreStatus> {
  const store = getCatalogStore();
  if (!store.pullRemoteToLocal) return store.status();
  const status = await store.pullRemoteToLocal();
  invalidateCatalogCache();
  return status;
}

export async function writeCatalog(catalog: Catalog): Promise<void> {
  await getCatalogStore().write(catalog);
  invalidateCatalogCache();
}
