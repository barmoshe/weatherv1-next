"use client";
import { useQuery } from "@tanstack/react-query";

export type StorageMode = "cloud" | "local";

export interface CloudStorageStatus {
  enabled: boolean;
  ready: boolean;
  gatewayUrl?: string;
  tenantId?: string;
  bucketName?: string;
  /** Saved username for the worker Basic-Auth login (non-secret). */
  appUsername?: string;
  lastSyncAt?: string;
  conflict?: { remoteEtag: string; localHash: string; detectedAt: string };
  error?: string;
  counts: { local: number; cloudOnly: number; syncing: number; error: number };
  catalogLoaded: boolean;
}

export interface LocalCacheStatus {
  role: "cache" | "workspace";
  isDefault: boolean;
  workspaceDir: string;
  catalogPath: string;
  videosDir: string;
  ready: boolean;
  missing: string[];
  catalogCount: number;
}

export interface StorageStatus {
  mode: StorageMode;
  cloud: CloudStorageStatus;
  localCache: LocalCacheStatus;
}

interface DesktopStatusEnvelope {
  success: boolean;
  storage?: StorageStatus;
}

export function useStorageStatus() {
  return useQuery<StorageStatus | null>({
    queryKey: ["storage-status"],
    queryFn: async () => {
      const res = await fetch("/api/desktop/status");
      if (!res.ok) return null;
      const data = (await res.json()) as DesktopStatusEnvelope;
      return data.storage ?? null;
    },
    staleTime: 5_000,
    refetchInterval: 15_000,
  });
}
