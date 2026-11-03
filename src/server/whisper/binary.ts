// Local whisper.cpp binary resolver.
//
// Resolution order:
//   1. `WHISPER_CLI_PATH` env override (server runtime, or a dev pointing at
//      their own build).
//   2. Packaged app: `<resources>/whisper/` — forge ships `resources/whisper/`
//      as an extraResource (outside asar), and Electron forwards
//      `process.resourcesPath` to the Next child as `WEATHER_RESOURCES_DIR`.
//   3. Dev: `<projectRoot>/resources/whisper/`, filled by
//      `scripts/fetch-whisper.mjs`.
//
// The binary is pinned in that script; nothing is looked up on PATH, so every
// machine runs the same whisper.cpp build.

import fs from "node:fs";
import path from "node:path";
import { getRuntimeConfig } from "@/server/runtime/config";

export interface WhisperBinaryResolution {
  path: string;
  source: "env" | "bundled" | "dev";
}

export function whisperBinaryName(): string {
  return process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

export function resolveWhisperBinary(): WhisperBinaryResolution | null {
  const override = process.env.WHISPER_CLI_PATH?.trim();
  if (override) return isFile(override) ? { path: override, source: "env" } : null;

  const resourcesDir = process.env.WEATHER_RESOURCES_DIR?.trim();
  if (resourcesDir) {
    const bundled = path.join(resourcesDir, "whisper", whisperBinaryName());
    if (isFile(bundled)) return { path: bundled, source: "bundled" };
  }

  const dev = path.join(getRuntimeConfig().projectRoot, "resources", "whisper", whisperBinaryName());
  if (isFile(dev)) return { path: dev, source: "dev" };

  return null;
}
