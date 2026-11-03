import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getAssetSource } from "@/server/assets/source";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { catalogStoreStatus } from "@/server/catalog/storage";
import { getR2SyncStatus, pullCatalogFromR2IfLocalEmpty } from "@/server/sync/r2/service";
import type { R2SyncStatus } from "@/server/sync/r2/types";
import type { WorkspaceValidation } from "@/server/assets/source";
import { resolveWhisperBinary } from "@/server/whisper/binary";
import { getModelStatus } from "@/server/whisper/models";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";

function activeLlmModel(): string | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
}

function buildStorageBlock(args: {
  workspace: WorkspaceValidation;
  r2: R2SyncStatus;
  userDataDir: string | null;
  catalogVideoCount: number;
  presentVideoCount: number;
}) {
  const { workspace, r2, userDataDir, catalogVideoCount, presentVideoCount } = args;

  // The "default" local cache lives under the Electron userData dir. When the
  // workspace points there, treat the local folder as an app-managed cache.
  const isDefaultCache = Boolean(
    userDataDir && workspace.workspaceDir.startsWith(path.join(userDataDir, "local-cache")),
  );

  return {
    // "cloud" — R2 is the source of truth and the UI should drive onboarding
    // through the cloud connect gate first.
    // "local" — no cloud configured; UI behaves like the dev/local-only mode.
    mode: r2.enabled ? "cloud" : "local",
    cloud: {
      enabled: r2.enabled,
      ready: r2.ready,
      gatewayUrl: r2.gatewayUrl,
      tenantId: r2.tenantId,
      bucketName: r2.bucketName,
      appUsername: r2.appUsername,
      lastSyncAt: r2.lastSyncAt,
      conflict: r2.conflict,
      error: r2.error,
      counts: r2.counts,
      catalogLoaded: r2.ready && catalogVideoCount > 0,
    },
    localCache: {
      role: r2.enabled ? ("cache" as const) : ("workspace" as const),
      isDefault: isDefaultCache,
      workspaceDir: workspace.workspaceDir,
      catalogPath: workspace.catalogPath,
      videosDir: workspace.videosDir,
      ready: workspace.ready,
      missing: workspace.missing,
      catalogCount: catalogVideoCount,
      presentCount: presentVideoCount,
    },
  };
}

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const config = getRuntimeConfig();
  const runtime = getRuntimePaths();

  // Trigger the cloud-first bootstrap before we read the workspace state so
  // the storage block reflects a freshly scaffolded local cache when the
  // user has just connected R2. The helper is idempotent within the process.
  await pullCatalogFromR2IfLocalEmpty();

  const workspace = getAssetSource().validateWorkspace();

  const r2 = await getR2SyncStatus();

  // getR2SyncStatus() above already ran the full catalog parse (statusCounts
  // is unconditional); availability is total over these four buckets, so the
  // counts we need are pure arithmetic — no second parse on this polled route.
  const catalogVideoCount =
    r2.counts.local + r2.counts.cloudOnly + r2.counts.syncing + r2.counts.error;
  const presentVideoCount = r2.counts.local;

  const storage = buildStorageBlock({
    workspace,
    r2,
    userDataDir: config.userDataDir,
    catalogVideoCount,
    presentVideoCount,
  });

  const whisper = getModelStatus();

  return NextResponse.json({
    success: true,
    desktop_mode: config.desktopMode,
    workspace,
    runtime: {
      runtime_dir: runtime.runtimeDir,
      uploads_dir: runtime.uploadsDir,
      outputs_dir: runtime.outputsDir,
      cache_dir: runtime.cacheDir,
    },
    keys: {
      anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY),
    },
    providers: {
      plan_pipeline:
        process.env.PLAN_PIPELINE_VER2 === "0" || process.env.PLAN_PIPELINE_VER2 === "false"
          ? "ver1"
          : "ver2",
      llm_active: process.env.ANTHROPIC_API_KEY ? "anthropic" : null,
      llm_model: activeLlmModel(),
      // Transcription is local whisper.cpp: active once the bundled binary
      // and the downloaded Hebrew model are both present.
      transcription_active: resolveWhisperBinary() && whisper.state === "ready" ? "local-whisper" : null,
    },
    whisper: {
      ...whisper,
      binary_found: resolveWhisperBinary() !== null,
    },
    ffmpeg: {
      ffmpeg_path: config.ffmpegPath ?? null,
      ffprobe_path: config.ffprobePath ?? null,
      bg_music_path: config.bgMusicPath,
    },
    catalog_store: catalogStoreStatus(),
    r2,
    storage,
  });
}
