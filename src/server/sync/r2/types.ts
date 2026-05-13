export type R2Availability = "local" | "cloud_only" | "syncing" | "error";

export interface R2TemporaryCredentials {
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  expiresAt: string;
  tenantPrefix?: string;
}

export interface R2ObjectProgress {
  key: string;
  status: "uploading" | "downloading" | "synced" | "error";
  loaded?: number;
  total?: number;
  updatedAt: string;
  error?: string;
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
  error?: string;
}
