import type { LlmProviderPreference } from "@/shared/desktop";
import type { StorageStatus } from "@/client/hooks/useStorageStatus";

export interface CatalogHealth {
  loaded_count?: number;
  claimed_count?: number;
  missing_ids?: string[];
  version?: string;
}

/** Desktop `/api/desktop/status` payload shape used by settings panels */
export interface DesktopStatus {
  success: boolean;
  desktop_mode: boolean;
  workspace: {
    workspaceDir: string;
    catalogPath: string;
    videosDir: string;
    musicDir: string;
    missing: string[];
    ready: boolean;
  };
  runtime: {
    runtime_dir: string;
    uploads_dir: string;
    outputs_dir: string;
    cache_dir: string;
  };
  keys: {
    openai_configured: boolean;
    anthropic_configured: boolean;
    gemini_configured: boolean;
  };
  providers?: {
    llm_pref: LlmProviderPreference;
  };
  ffmpeg: {
    ffmpeg_path: string | null;
    ffprobe_path: string | null;
    bg_music_path: string;
  };
  catalog_store?: {
    kind: "local";
    enabled: boolean;
    ready: boolean;
  };
  r2?: {
    enabled: boolean;
    ready: boolean;
    gatewayUrl?: string;
    tenantId?: string;
    bucketName?: string;
    appUsername?: string;
    lastCatalogEtag?: string;
    lastSyncAt?: string;
    conflict?: { remoteEtag: string; localHash: string; detectedAt: string };
    counts: { local: number; cloudOnly: number; syncing: number; error: number };
    error?: string;
  };
  storage?: StorageStatus;
}


export type DotVariant = "ok" | "warn" | "danger";
