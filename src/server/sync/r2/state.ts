import fs from "node:fs";
import path from "node:path";
import { getRuntimeConfig } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import type { R2ObjectProgress, R2SyncState } from "./types";

function statePath(): string {
  const cfg = getRuntimeConfig();
  return cfg.r2.statePath ?? path.join(getRuntimePaths().runtimeDir, "r2-sync-state.json");
}

export function readR2SyncState(): R2SyncState {
  try {
    const p = statePath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8")) as R2SyncState;
  } catch {
    return {};
  }
}

export function writeR2SyncState(state: R2SyncState): void {
  const p = statePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2), "utf8");
  fs.renameSync(tmp, p);
}

export function patchObjectProgress(key: string, patch: Omit<Partial<R2ObjectProgress>, "key">): void {
  const state = readR2SyncState();
  const previous = state.objects?.[key] ?? { key, status: "uploading", updatedAt: new Date().toISOString() };
  writeR2SyncState({
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
  });
}
