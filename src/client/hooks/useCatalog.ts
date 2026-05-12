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
  return useQuery<{ tags: Record<string, number>; sources: Record<string, number> }>({
    queryKey: ["tag-counts"],
    queryFn: async () => {
      const res = await fetch("/api/catalog/tag-counts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ tags: Record<string, number>; sources: Record<string, number> }>;
    },
    staleTime: 30_000,
  });
}
