import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { CatalogSchema, type Catalog, type CatalogEntry, type ParsedVideo } from "@/shared/types";
import { getVideosDir, invalidateCatalogCache, readCatalog, writeCatalog } from "@/server/catalog/storage";
import { parseCatalog } from "@/server/catalog/parser";
import { getAssetSource } from "@/server/assets/source";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { catalogHash, catalogJson } from "@/server/catalog/stores";
import { generateAt, generatePoster } from "@/server/ffmpeg/posters";
import {
  downloadR2File,
  getR2Text,
  headR2Object,
  putR2Text,
  r2Configured,
  tenantKey,
  uploadR2File,
} from "./client";
import { patchObjectProgress, readR2SyncState, writeR2SyncState } from "./state";
import type { R2SyncStatus } from "./types";

export class R2CatalogConflictError extends Error {
  constructor(message = "remote catalog changed; pull latest or replace remote") {
    super(message);
    this.name = "R2CatalogConflictError";
  }
}

function catalogKey(): string {
  return tenantKey("catalog/catalog.json");
}

function mimeFor(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  if (ext === ".mov") return "video/quicktime";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  return "application/octet-stream";
}

function videoRemoteKey(entry: CatalogEntry): string {
  const cleanName = path.basename(entry.filename || entry.original_filename || `${entry.id}.mp4`);
  return tenantKey(`videos/${entry.id}/${cleanName}`);
}

function clipPosterKey(videoId: string): string {
  return tenantKey(`posters/clips/${videoId}.jpg`);
}

function segmentPosterKey(segmentId: string): string {
  return tenantKey(`posters/segments/${segmentId}.jpg`);
}

function shaFile(filePath: string): string {
  return createHash("sha1").update(fs.readFileSync(filePath)).digest("hex");
}

function statusCounts(): R2SyncStatus["counts"] {
  const counts = { local: 0, cloudOnly: 0, syncing: 0, error: 0 };
  for (const video of parseCatalog(readCatalog())) {
    if (video.availability === "local") counts.local++;
    if (video.availability === "cloud_only") counts.cloudOnly++;
    if (video.availability === "syncing") counts.syncing++;
    if (video.availability === "error") counts.error++;
  }
  return counts;
}

export async function getR2SyncStatus(): Promise<R2SyncStatus> {
  const cfg = getRuntimeConfig().r2;
  const state = readR2SyncState();
  const enabled = Boolean(cfg.enabled);
  const ready = r2Configured();
  return {
    enabled,
    ready,
    gatewayUrl: cfg.gatewayUrl,
    tenantId: cfg.tenantId,
    bucketName: cfg.bucketName,
    tenantPrefix: cfg.tenantId ? `tenants/${cfg.tenantId}` : undefined,
    appUsername: cfg.appUsername,
    lastCatalogEtag: state.lastCatalogEtag,
    lastSyncAt: state.lastSyncAt,
    conflict: state.conflict,
    counts: statusCounts(),
    error: enabled && !ready ? "R2 sync is enabled but gateway URL, tenant ID, username, or password is missing" : undefined,
  };
}

export async function pullCatalogFromR2(): Promise<R2SyncStatus> {
  if (!r2Configured()) return getR2SyncStatus();
  const remote = await getR2Text(catalogKey());
  const catalog = CatalogSchema.parse(JSON.parse(remote.text));
  await writeCatalog(catalog);
  writeR2SyncState({
    ...readR2SyncState(),
    lastCatalogEtag: remote.etag,
    lastCatalogHash: catalogHash(catalog),
    lastSyncAt: new Date().toISOString(),
    conflict: undefined,
  });
  invalidateCatalogCache();
  return getR2SyncStatus();
}

// Tracks whether we've already attempted an auto-pull this process so we
// don't spam R2 on every status poll. The Electron main restarts the Next
// child whenever settings change (e.g. a new app token), which gives us a
// fresh module instance and a fresh attempt automatically.
let autoBootstrapAttempted = false;

/**
 * Auto-bootstrap the local catalog from R2 if it's empty or missing. Safe to
 * call from request handlers; this never overwrites a non-empty local
 * catalog. Skips silently when R2 is not configured.
 */
export async function pullCatalogFromR2IfLocalEmpty(): Promise<void> {
  if (!r2Configured()) return;
  if (autoBootstrapAttempted) return;

  // Make sure the local cache is laid out before we try to read or write the
  // catalog. In packaged builds the workspace is the app-managed cache under
  // userData and may not exist yet on first launch.
  try {
    getAssetSource().ensureWorkspaceScaffold();
  } catch (err) {
    console.warn("[r2:bootstrap] failed to scaffold local cache:", err);
  }

  let catalog: Catalog;
  try {
    catalog = readCatalog();
  } catch (err) {
    console.warn("[r2:bootstrap] failed to read local catalog:", err);
    autoBootstrapAttempted = true;
    return;
  }

  if (catalog.videos.length > 0) {
    // Local catalog already populated — never silently overwrite the user's
    // local source-of-truth. A manual pull is still available from Settings.
    autoBootstrapAttempted = true;
    return;
  }

  autoBootstrapAttempted = true;
  console.info("[r2:bootstrap] local catalog is empty; pulling from R2…");
  try {
    const status = await pullCatalogFromR2();
    console.info(
      `[r2:bootstrap] pulled remote catalog (etag=${status.lastCatalogEtag ?? "?"}, local=${status.counts.local}, cloudOnly=${status.counts.cloudOnly})`,
    );
  } catch (err) {
    console.warn("[r2:bootstrap] auto-pull skipped:", err);
  }
}

/** Test-only: reset the in-process auto-pull guard. */
export function resetR2AutoBootstrapForTests(): void {
  autoBootstrapAttempted = false;
}

export async function pushCatalogToR2(args: { replaceRemote?: boolean } = {}): Promise<R2SyncStatus> {
  if (!r2Configured()) return getR2SyncStatus();
  const catalog = readCatalog();
  const state = readR2SyncState();
  const remote = await headR2Object(catalogKey());
  const localHash = catalogHash(catalog);

  if (remote?.etag && !args.replaceRemote) {
    const known = state.lastCatalogEtag;
    if (!known || known !== remote.etag) {
      const conflict = { remoteEtag: remote.etag, localHash, detectedAt: new Date().toISOString() };
      writeR2SyncState({ ...state, conflict });
      throw new R2CatalogConflictError();
    }
  }

  const result = await putR2Text(catalogKey(), catalogJson(catalog));
  writeR2SyncState({
    ...state,
    lastCatalogEtag: result.etag,
    lastCatalogHash: localHash,
    lastSyncAt: new Date().toISOString(),
    conflict: undefined,
  });
  return getR2SyncStatus();
}

export async function replaceRemoteCatalog(): Promise<R2SyncStatus> {
  return pushCatalogToR2({ replaceRemote: true });
}

export async function uploadVideoForEntry(videoId: string): Promise<void> {
  if (!r2Configured()) return;
  const catalog = readCatalog();
  const entry = catalog.videos.find((v) => v.id === videoId);
  if (!entry?.filename) return;
  const localPath = path.join(getVideosDir(), entry.filename);
  if (!fs.existsSync(localPath)) return;
  const key = entry.remote?.key ?? videoRemoteKey(entry);

  try {
    entry.remote = { ...(entry.remote ?? {}), key, status: "uploading" };
    await writeCatalog(catalog);
    patchObjectProgress(key, { status: "uploading", loaded: 0, total: fs.statSync(localPath).size });
    const uploaded = await uploadR2File(key, localPath, mimeFor(entry.filename), (loaded, total) => {
      patchObjectProgress(key, { status: "uploading", loaded, total });
    });
    const nextCatalog = readCatalog();
    const nextEntry = nextCatalog.videos.find((v) => v.id === videoId);
    if (nextEntry) {
      nextEntry.remote = {
        ...(nextEntry.remote ?? {}),
        key,
        etag: uploaded.etag ?? shaFile(localPath),
        size: uploaded.size,
        uploadedAt: new Date().toISOString(),
        status: "local",
        error: undefined,
      };
      await writeCatalog(nextCatalog);
    }
    patchObjectProgress(key, { status: "synced", loaded: uploaded.size, total: uploaded.size });
    try {
      await pushCatalogToR2({ replaceRemote: false });
    } catch (err) {
      if (!(err instanceof R2CatalogConflictError)) throw err;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextCatalog = readCatalog();
    const nextEntry = nextCatalog.videos.find((v) => v.id === videoId);
    if (nextEntry) {
      nextEntry.remote = { ...(nextEntry.remote ?? {}), key, status: "error", error: message };
      await writeCatalog(nextCatalog);
    }
    patchObjectProgress(key, { status: "error", error: message });
    throw err;
  }
}

export async function syncPostersForVideo(videoId: string, force = false): Promise<void> {
  if (!r2Configured()) return;
  const catalog = readCatalog();
  const entry = catalog.videos.find((v) => v.id === videoId);
  if (!entry?.filename) return;
  const localPath = path.join(getVideosDir(), entry.filename);
  if (!fs.existsSync(localPath)) return;

  const { postersDir, segmentPostersDir } = getRuntimePaths();
  const clipPosterPath = await generatePoster(localPath, videoId, postersDir, force);
  if (clipPosterPath && fs.existsSync(clipPosterPath)) {
    await uploadR2File(clipPosterKey(videoId), clipPosterPath, "image/jpeg");
  }

  for (const segment of entry.segments ?? []) {
    if (!segment.id) continue;
    const midpoint = ((segment.start_sec ?? 0) + (segment.end_sec ?? 0)) / 2;
    const posterPath = await generateAt(localPath, segment.id, midpoint, segmentPostersDir, force);
    if (posterPath && fs.existsSync(posterPath)) {
      await uploadR2File(segmentPosterKey(segment.id), posterPath, "image/jpeg");
    }
  }
}

export async function materializeVideo(videoId: string): Promise<ParsedVideo> {
  const catalog: Catalog = readCatalog();
  const entry = catalog.videos.find((v) => v.id === videoId);
  if (!entry) throw new Error(`Video ${videoId} not found`);
  const localPath = path.join(getVideosDir(), entry.filename);
  if (fs.existsSync(localPath)) {
    return parseCatalog(catalog).find((v) => v.id === videoId)!;
  }
  const key = entry.remote?.key;
  if (!key) throw new Error(`Video ${videoId} has no R2 object key`);

  entry.remote = { ...(entry.remote ?? {}), status: "downloading", error: undefined };
  await writeCatalog(catalog);
  patchObjectProgress(key, { status: "downloading" });

  try {
    const downloaded = await downloadR2File(key, localPath);
    const nextCatalog = readCatalog();
    const nextEntry = nextCatalog.videos.find((v) => v.id === videoId);
    if (nextEntry) {
      nextEntry.remote = {
        ...(nextEntry.remote ?? {}),
        key,
        etag: downloaded.etag ?? nextEntry.remote?.etag,
        size: downloaded.size ?? nextEntry.remote?.size,
        uploadedAt: downloaded.updatedAt ?? nextEntry.remote?.uploadedAt,
        status: "local",
        error: undefined,
      };
      await writeCatalog(nextCatalog);
    }
    patchObjectProgress(key, { status: "synced", loaded: downloaded.size, total: downloaded.size });
    return parseCatalog(readCatalog()).find((v) => v.id === videoId)!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const nextCatalog = readCatalog();
    const nextEntry = nextCatalog.videos.find((v) => v.id === videoId);
    if (nextEntry) {
      nextEntry.remote = { ...(nextEntry.remote ?? {}), key, status: "error", error: message };
      await writeCatalog(nextCatalog);
    }
    patchObjectProgress(key, { status: "error", error: message });
    throw err;
  }
}

export async function retryR2Sync(videoId?: string): Promise<R2SyncStatus> {
  if (videoId) await uploadVideoForEntry(videoId);
  else await pushCatalogToR2();
  return getR2SyncStatus();
}

export async function uploadRuntimeFile(relativeKey: string, filePath: string): Promise<void> {
  if (!r2Configured() || !fs.existsSync(filePath)) return;
  const key = tenantKey(relativeKey);
  await uploadR2File(key, filePath, mimeFor(filePath));
}
