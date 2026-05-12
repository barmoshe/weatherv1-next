// Local whisper.cpp binary resolver.
//
// Resolution order, mirroring `electron/ffmpeg-verify.cjs`:
//   1. `WHISPER_CLI_PATH` env override — used by the Server/Web runtime where
//      the operator installs whisper.cpp via package manager.
//   2. Bundled binary under `electron/bin/whisper/<platform>-<arch>/`. In
//      packaged Electron builds this lives at `Resources/app.asar.unpacked/
//      electron/bin/whisper/...`. The `asarUnpack` entry in forge.config.cjs
//      makes the unpacked path real on disk; we rewrite `app.asar →
//      app.asar.unpacked` at call time the same way ffmpeg-verify does.
//   3. Workspace cache under `<cacheDir>/whisper-bin/<platform>-<arch>/`.
//      This is the writable slot used by the in-app downloader so Windows
//      users (where there is no `brew install whisper-cpp`) can get a working
//      binary without rebuilding the installer.
//   4. System PATH (`whisper-cli`, then `whisper.cpp`, then `main` as a
//      legacy whisper.cpp name).
//
// Vendor instructions for the bundled binaries (one-time, per release):
//   - macOS arm64: download whisper.cpp release `whisper-cli` built with
//     `-DWHISPER_METAL=1` from https://github.com/ggml-org/whisper.cpp/releases
//     and copy to `electron/bin/whisper/darwin-arm64/whisper-cli`.
//   - macOS x64:   `electron/bin/whisper/darwin-x64/whisper-cli`.
//   - Windows x64: `electron/bin/whisper/win32-x64/whisper-cli.exe`.
//   chmod +x on macOS targets, and notarize via the existing osxSign step.

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getRuntimePaths } from "@/server/runtime/paths";

const execFileAsync = promisify(execFile);

export interface WhisperBinaryResolution {
  path: string;
  source: "env" | "bundled" | "workspace" | "path";
}

const PROJECT_ROOT = path.resolve(__dirname, "..", "..", "..");

/** Path that bundled binaries live at, before asar unpacking is considered. */
export function bundledBinaryDir(): string {
  const platformArch = `${process.platform}-${process.arch}`;
  return path.join(PROJECT_ROOT, "electron", "bin", "whisper", platformArch);
}

/** Path that bundled models live at — same packaging pattern as binaries. */
export function bundledModelsDir(): string {
  return path.join(PROJECT_ROOT, "electron", "bin", "whisper", "models");
}

/**
 * Writable per-workspace location for downloaded whisper.cpp binaries.
 * `<cache>/whisper-bin/<platform>-<arch>/whisper-cli[.exe]`.
 * Used by the in-app downloader so non-bundled platforms (Windows out of
 * the box) can install whisper.cpp without rebuilding the installer.
 */
export function workspaceBinaryDir(): string {
  const platformArch = `${process.platform}-${process.arch}`;
  return path.join(getRuntimePaths().cacheDir, "whisper-bin", platformArch);
}

function unpackAsarPath(p: string): string {
  // Rewrites `…/app.asar/…` to `…/app.asar.unpacked/…`. The unpacked path
  // only exists if forge.config.cjs marks the binary for asarUnpack.
  return p.replace(/([/\\])app\.asar([/\\])/, "$1app.asar.unpacked$2");
}

function binaryName(): string {
  return process.platform === "win32" ? "whisper-cli.exe" : "whisper-cli";
}

function tryEnvOverride(): WhisperBinaryResolution | null {
  const raw = process.env.WHISPER_CLI_PATH?.trim();
  if (!raw) return null;
  if (!fs.existsSync(raw)) return null;
  return { path: raw, source: "env" };
}

function tryBundled(): WhisperBinaryResolution | null {
  const candidate = unpackAsarPath(path.join(bundledBinaryDir(), binaryName()));
  if (fs.existsSync(candidate)) return { path: candidate, source: "bundled" };
  return null;
}

function tryWorkspaceCache(): WhisperBinaryResolution | null {
  try {
    const candidate = path.join(workspaceBinaryDir(), binaryName());
    if (fs.existsSync(candidate)) return { path: candidate, source: "workspace" };
  } catch {
    // workspace not configured yet (e.g. during first launch); silently skip.
  }
  return null;
}

function tryPath(): WhisperBinaryResolution | null {
  // Mirror ffmpeg-verify's approach: shell out to which/where with the names
  // whisper.cpp builds publish. Order matters — modern builds emit
  // `whisper-cli`; legacy builds emit `main`.
  const candidates = ["whisper-cli", "whisper.cpp", "main"];
  const cmd = process.platform === "win32" ? "where" : "which";
  for (const name of candidates) {
    try {
      const { execFileSync } = require("node:child_process") as typeof import("node:child_process");
      const raw = execFileSync(cmd, [name], { encoding: "utf8" }).trim();
      const first = raw.split(/\r?\n/)[0]?.trim();
      if (first && fs.existsSync(first)) return { path: first, source: "path" };
    } catch {
      // not found on PATH
    }
  }
  return null;
}

/**
 * Resolve the whisper.cpp binary path. Returns null when nothing is available
 * — callers surface this as a structured `whisper_local_binary_missing`
 * error so the UI can prompt the user to download/install.
 */
export function resolveWhisperBinary(): WhisperBinaryResolution | null {
  return tryEnvOverride() ?? tryBundled() ?? tryWorkspaceCache() ?? tryPath();
}

/** Run `<binary> --version`. Used by /api/desktop/status to confirm health. */
export async function probeWhisperBinary(binPath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    await execFileAsync(binPath, ["--help"], { timeout: 5000 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
