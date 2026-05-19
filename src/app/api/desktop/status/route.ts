import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import { getAssetSource } from "@/server/assets/source";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { catalogStoreStatus, readCatalog } from "@/server/catalog/storage";
import { getR2SyncStatus, pullCatalogFromR2IfLocalEmpty } from "@/server/sync/r2/service";
import type { R2SyncStatus } from "@/server/sync/r2/types";
import type { WorkspaceValidation } from "@/server/assets/source";

const DEFAULT_CLAUDE_MODEL = "claude-sonnet-4-6";
const DEFAULT_OPENAI_MODEL = "gpt-4o";

function pickActiveLlm(): "anthropic" | "openai" | null {
  const pref = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const haveAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);
  const haveOpenAi = Boolean(process.env.OPENAI_API_KEY);
  if (pref === "anthropic") return haveAnthropic ? "anthropic" : null;
  if (pref === "openai") return haveOpenAi ? "openai" : null;
  if (haveAnthropic) return "anthropic";
  if (haveOpenAi) return "openai";
  return null;
}

function pickActiveLlmModel(): string | null {
  const active = pickActiveLlm();
  if (active === "anthropic") return process.env.CLAUDE_MODEL?.trim() || DEFAULT_CLAUDE_MODEL;
  if (active === "openai") return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
  return null;
}

function buildStorageBlock(args: {
  workspace: WorkspaceValidation;
  r2: R2SyncStatus;
  userDataDir: string | null;
  catalogVideoCount: number;
}) {
  const { workspace, r2, userDataDir, catalogVideoCount } = args;

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

  let catalogVideoCount = 0;
  try {
    catalogVideoCount = readCatalog().videos.length;
  } catch {
    catalogVideoCount = 0;
  }

  const storage = buildStorageBlock({
    workspace,
    r2,
    userDataDir: config.userDataDir,
    catalogVideoCount,
  });

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
      openai_configured: Boolean(process.env.OPENAI_API_KEY),
      anthropic_configured: Boolean(process.env.ANTHROPIC_API_KEY),
      gemini_configured: Boolean(process.env.GEMINI_API_KEY),
    },
    providers: {
      llm_pref: process.env.LLM_PROVIDER ?? "auto",
      plan_pipeline: process.env.PLAN_PIPELINE_VER2 === "1" ? "ver2" : "ver1",
      llm_active: pickActiveLlm(),
      llm_model: pickActiveLlmModel(),
      // Transcription is OpenAI cloud Whisper only. The active provider is
      // "openai-cloud" when a key is configured, null otherwise.
      transcription_active: process.env.OPENAI_API_KEY ? "openai-cloud" : null,
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
