// Electron-main FFmpeg verification.
//
// This module runs in the Electron main process *before* the standalone Next
// child is spawned. Per the desktop plan, instrumentation.ts is unreliable in
// packaged builds (vercel/next.js#89377), so the authoritative gate lives
// here. Electron main exposes the result to the renderer via the preload
// bridge and surfaces it in the settings UI.
//
// Resolution order for each binary:
//   1. Explicit env override (FFMPEG_PATH / FFPROBE_PATH).
//   2. Bundled binary from `ffmpeg-static` / `ffprobe-static` /
//      `@ffmpeg-installer/ffmpeg` / `@ffprobe-installer/ffprobe`, if installed.
//      In packaged builds these point inside `app.asar`; we rewrite to
//      `app.asar.unpacked` because executables packed into asar cannot be
//      exec'd. Listing the binaries in `asarUnpack` (Step 6) is what makes
//      the rewritten path real on disk.
//   3. System PATH via `which` / `where`.
//
// This module is CommonJS so it can be `require`'d from `electron/main.cjs`
// without needing an ESM-in-Electron bootstrap.

"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

/**
 * Rewrite a path that lives inside `app.asar` to the corresponding
 * `app.asar.unpacked` path. Returns the original path unchanged if it doesn't
 * live inside an asar archive.
 *
 * Why: Electron cannot exec binaries packed inside `app.asar`. Forge's
 * `asarUnpack` setting (Step 6) materializes them in `app.asar.unpacked`,
 * but module exports like `require("ffmpeg-static")` still return the
 * `app.asar` path. We rewrite at call time.
 */
function unpackAsarPath(p) {
  if (typeof p !== "string" || !p) return p;
  // Match both POSIX and Windows separators.
  return p.replace(/([\/\\])app\.asar([\/\\])/, "$1app.asar.unpacked$2");
}

/** Try to require a module without throwing if it isn't installed. */
function tryRequire(id) {
  try {
    return require(id);
  } catch {
    return null;
  }
}

/**
 * Resolve a bundled binary path from one of the known npm packages.
 * Each candidate accessor returns the raw string path from the module, or
 * null if the package isn't installed or doesn't expose a path.
 */
function resolveBundled(kind) {
  const candidates =
    kind === "ffmpeg"
      ? [
          () => {
            const m = tryRequire("ffmpeg-static");
            // ffmpeg-static exports the path string as default.
            return typeof m === "string" ? m : null;
          },
          () => {
            const m = tryRequire("@ffmpeg-installer/ffmpeg");
            return m && typeof m.path === "string" ? m.path : null;
          },
        ]
      : [
          () => {
            const m = tryRequire("ffprobe-static");
            return m && typeof m.path === "string" ? m.path : null;
          },
          () => {
            const m = tryRequire("@ffprobe-installer/ffprobe");
            return m && typeof m.path === "string" ? m.path : null;
          },
        ];

  for (const get of candidates) {
    try {
      const raw = get();
      if (raw) {
        const unpacked = unpackAsarPath(raw);
        if (fs.existsSync(unpacked)) return unpacked;
      }
    } catch {
      // ignore and try next
    }
  }
  return null;
}

/** Resolve via system PATH using `which`/`where`. Returns null on failure. */
function resolveFromPath(name) {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const out = execFileSync(cmd, [name], { encoding: "utf8" }).trim();
    if (!out) return null;
    // `where` on Windows can return multiple lines; take the first.
    const first = out.split(/\r?\n/)[0].trim();
    return first || null;
  } catch {
    return null;
  }
}

/**
 * Resolve a single binary by name. Returns the resolved absolute path and
 * the source ("env" | "bundled" | "path"). Returns null if nothing was found.
 */
function resolveBinary(name, envPath) {
  if (envPath && typeof envPath === "string" && envPath.trim()) {
    const trimmed = envPath.trim();
    if (fs.existsSync(trimmed)) return { path: trimmed, source: "env" };
    return { path: trimmed, source: "env", warning: "env path does not exist on disk" };
  }
  const bundled = resolveBundled(name);
  if (bundled) return { path: bundled, source: "bundled" };
  const onPath = resolveFromPath(name);
  if (onPath) return { path: onPath, source: "path" };
  return null;
}

/**
 * Run `<binary> -version` to confirm the binary is executable. Returns null
 * on success, or an Error-shaped message on failure.
 */
function probe(binaryPath) {
  try {
    execFileSync(binaryPath, ["-version"], { stdio: "pipe", timeout: 5000 });
    return null;
  } catch (err) {
    return err && err.message ? err.message : String(err);
  }
}

/**
 * Verify ffmpeg + ffprobe and return a structured result. Never throws.
 *
 * @param {{ ffmpegPath?: string, ffprobePath?: string }} [opts]
 * @returns {{
 *   ok: boolean,
 *   ffmpegPath: string | null,
 *   ffprobePath: string | null,
 *   ffmpegSource: string | null,
 *   ffprobeSource: string | null,
 *   errors: string[],
 *   warnings: string[],
 * }}
 */
function verifyFFmpeg(opts) {
  const o = opts || {};
  const errors = [];
  const warnings = [];

  const ffmpeg = resolveBinary("ffmpeg", o.ffmpegPath || process.env.FFMPEG_PATH);
  const ffprobe = resolveBinary("ffprobe", o.ffprobePath || process.env.FFPROBE_PATH);

  if (!ffmpeg) errors.push("ffmpeg not found (no env, bundled, or PATH match)");
  if (!ffprobe) errors.push("ffprobe not found (no env, bundled, or PATH match)");

  if (ffmpeg && ffmpeg.warning) warnings.push(`ffmpeg: ${ffmpeg.warning}`);
  if (ffprobe && ffprobe.warning) warnings.push(`ffprobe: ${ffprobe.warning}`);

  if (ffmpeg) {
    const err = probe(ffmpeg.path);
    if (err) errors.push(`ffmpeg -version failed: ${err}`);
  }
  if (ffprobe) {
    const err = probe(ffprobe.path);
    if (err) errors.push(`ffprobe -version failed: ${err}`);
  }

  return {
    ok: errors.length === 0 && Boolean(ffmpeg) && Boolean(ffprobe),
    ffmpegPath: ffmpeg ? ffmpeg.path : null,
    ffprobePath: ffprobe ? ffprobe.path : null,
    ffmpegSource: ffmpeg ? ffmpeg.source : null,
    ffprobeSource: ffprobe ? ffprobe.source : null,
    errors,
    warnings,
  };
}

module.exports = {
  verifyFFmpeg,
  unpackAsarPath,
  // Exported for tests; not part of the stable API.
  __internal: { resolveBundled, resolveFromPath, resolveBinary, probe },
};
