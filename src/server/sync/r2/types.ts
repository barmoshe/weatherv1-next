export type R2Availability = "local" | "cloud_only" | "syncing" | "error";

export interface R2ObjectProgress {
  key: string;
  status: "uploading" | "downloading" | "synced" | "error";
  loaded?: number;
  total?: number;
  updatedAt: string;
  error?: string;
}

export interface R2MirrorOp {
  id: string;
  kind: "jobs" | "plan";
  key: string;
  jobId?: string;
  enqueuedAt: string;
  attempts: number;
  lastError?: string;
  nextAttemptAt?: string;
  dead?: boolean;
}

export interface R2SyncState {
  lastCatalogEtag?: string;
  lastCatalogHash?: string;
  lastSyncAt?: string;
  conflict?: {
    remoteEtag: string;
    localHash: string;
    detectedAt: string;
  };
  objects?: Record<string, R2ObjectProgress>;
  /** Durable mirror op-log; see `src/server/sync/r2/mirror-queue.ts`. */
  mirrors?: R2MirrorOp[];
  /** Last error from the mirror queue drainer, for UI surfacing. */
  lastMirrorError?: string;
}

export interface R2SyncStatus {
  enabled: boolean;
  ready: boolean;
  gatewayUrl?: string;
  tenantId?: string;
  bucketName?: string;
  tenantPrefix?: string;
  /**
   * Worker Basic-Auth username. Non-secret on purpose — the renderer uses it
   * to pre-fill the login screen so the user only re-enters their password.
   * Never expose `appPassword` over this channel.
   */
  appUsername?: string;
  lastCatalogEtag?: string;
  lastSyncAt?: string;
  conflict?: R2SyncState["conflict"];
  counts: {
    local: number;
    cloudOnly: number;
    syncing: number;
    error: number;
  };
  mirror?: {
    pending: number;
    dead: number;
    lastError?: string;
  };
  error?: string;
}
