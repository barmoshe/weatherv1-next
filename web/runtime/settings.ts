// Settings the Electron app kept in userData/settings.json, kept in IndexedDB
// here, and the env block the server code reads (the browser twin of
// electron/config.cjs `buildChildEnv`).

import { idbGet, idbSet } from "./idb";
import { RUNTIME_DIR, WS } from "./vfs";

export interface WebSettings {
  anthropicKey: string | null;
  planPipelineVer2: boolean;
}

const KEY = "settings";
const DEFAULTS: WebSettings = { anthropicKey: null, planPipelineVer2: true };

let current: WebSettings = { ...DEFAULTS };

export const SESSION_TOKEN = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
  b.toString(16).padStart(2, "0"),
).join("");

export function getSettings(): WebSettings {
  return current;
}

export async function loadSettings(): Promise<WebSettings> {
  current = { ...DEFAULTS, ...((await idbGet<Partial<WebSettings>>(KEY)) ?? {}) };
  applyEnv();
  return current;
}

export async function saveSettings(patch: Partial<WebSettings>): Promise<void> {
  current = { ...current, ...patch };
  await idbSet(KEY, current);
  applyEnv();
}

/** process.env for the in-page server code. Re-applied on every settings change. */
export function applyEnv(): void {
  const env = process.env as Record<string, string | undefined>;
  Object.assign(env, {
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
    DESKTOP_MODE: "1",
    DESKTOP_SESSION_TOKEN: SESSION_TOKEN,
    WEATHER_WORKSPACE_DIR: WS,
    WEATHER_RUNTIME_DIR: RUNTIME_DIR,
    WEATHER_USER_DATA_DIR: "/userdata",
    PLAN_PIPELINE_VER2: current.planPipelineVer2 ? "1" : "0",
  });
  if (current.anthropicKey) env.ANTHROPIC_API_KEY = current.anthropicKey;
  else delete env.ANTHROPIC_API_KEY;
}
