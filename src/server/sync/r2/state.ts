import path from "node:path";
import { z } from "zod";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { readJsonSync, updateJson } from "@/server/runtime/atomic-json";
import type { R2ObjectProgress, R2SyncState } from "./types";

const R2ObjectProgressSchema = z.object({
  key: z.string(),
  status: z.enum(["uploading", "downloading", "synced", "error"]),
  loaded: z.number().optional(),
  total: z.number().optional(),
  updatedAt: z.string(),
  error: z.string().optional(),
});

const MirrorOpSchema = z.object({
  id: z.string(),
  kind: z.enum(["jobs", "plan"]),
  key: z.string(),
  jobId: z.string().optional(),
  enqueuedAt: z.string(),
  attempts: z.number().int().nonnegative(),
  lastError: z.string().optional(),
  nextAttemptAt: z.string().optional(),
  dead: z.boolean().optional(),
});

export type MirrorOp = z.infer<typeof MirrorOpSchema>;

export const R2SyncStateSchema = z.object({
  lastCatalogEtag: z.string().optional(),
  lastCatalogHash: z.string().optional(),
  lastSyncAt: z.string().optional(),
  conflict: z
    .object({
      remoteEtag: z.string(),
      localHash: z.string(),
      detectedAt: z.string(),
    })
    .optional(),
  objects: z.record(z.string(), R2ObjectProgressSchema).optional(),
  mirrors: z.array(MirrorOpSchema).optional(),
  lastMirrorError: z.string().optional(),
});

const EMPTY_STATE: R2SyncState = {};

export function statePath(): string {
  const cfg = getRuntimeConfig();
  return cfg.r2.statePath ?? path.join(getRuntimePaths().runtimeDir, "r2-sync-state.json");
}

export function readR2SyncState(): R2SyncState {
  return readJsonSync(statePath(), R2SyncStateSchema, EMPTY_STATE) as R2SyncState;
}

/**
 * Read-modify-write the sync state under a cross-process advisory lock.
 * Use this instead of `readR2SyncState()` + manual mutate + write — those
 * two steps had a race that silently lost concurrent updates.
 */
export async function patchR2SyncState(
  mutator: (current: R2SyncState) => R2SyncState | Promise<R2SyncState>,
): Promise<R2SyncState> {
  return (await updateJson(
    statePath(),
    R2SyncStateSchema,
    EMPTY_STATE,
    mutator,
  )) as R2SyncState;
}

/** Wholesale replace (still atomic + locked). */
export async function writeR2SyncState(state: R2SyncState): Promise<void> {
  await patchR2SyncState(() => state);
}

export async function patchObjectProgress(
  key: string,
  patch: Omit<Partial<R2ObjectProgress>, "key">,
): Promise<void> {
  await patchR2SyncState((state) => {
    const previous = state.objects?.[key] ?? {
      key,
      status: "uploading" as const,
      updatedAt: new Date().toISOString(),
    };
    return {
      ...state,
      objects: {
        ...(state.objects ?? {}),
        [key]: {
          ...previous,
          ...patch,
          key,
          updatedAt: new Date().toISOString(),
        },
      },
    };
  });
}
