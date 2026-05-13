"use client";
import { useQuery } from "@tanstack/react-query";
import type { ParsedVideo } from "@/shared/types";

export interface R2SyncStatus {
  enabled: boolean;
  ready: boolean;
  gatewayUrl?: string;
  tenantId?: string;
  bucketName?: string;
  lastCatalogEtag?: string;
  lastSyncAt?: string;
  conflict?: { remoteEtag: string; localHash: string; detectedAt: string };
  counts: { local: number; cloudOnly: number; syncing: number; error: number };
  error?: string;
}

export interface CatalogTagCounts {
  success?: boolean;
  counts: Record<string, number>;
  segment_counts: Record<string, number>;
  source_counts: Record<string, number>;
  total: number;
  total_clips: number;
  total_segments: number;
  multi_segment_clips: number;
  single_segment_clips: number;
  clips_with_no_segments: number;
  remote_available_clips: number;
  remote_missing_clips: number;
  cached_local_clips: number;
  not_cached_local_clips: number;
  cloud_only_clips: number;
  syncing_clips: number;
  error_clips: number;
  untagged: number;
}

export function useCatalog() {
  return useQuery<ParsedVideo[]>({
    queryKey: ["catalog"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { videos?: ParsedVideo[] };
      return data.videos ?? [];
    },
    staleTime: 30_000,
  });
}

export function useR2SyncStatus() {
  return useQuery<R2SyncStatus>({
    queryKey: ["r2-sync-status"],
    queryFn: async () => {
      const res = await fetch("/api/sync/r2/status");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { r2?: R2SyncStatus };
      return data.r2 ?? { enabled: false, ready: false, counts: { local: 0, cloudOnly: 0, syncing: 0, error: 0 } };
    },
    staleTime: 10_000,
  });
}

export function useTagCounts() {
  return useQuery<CatalogTagCounts>({
    queryKey: ["tag-counts"],
    queryFn: async () => {
      const res = await fetch("/api/catalog/tag-counts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<CatalogTagCounts>;
    },
    staleTime: 30_000,
  });
}
