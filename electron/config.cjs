// Electron-main config layer.
//
// Owns:
//   - on-disk settings (workspace path, ffmpeg paths) in userData/settings.json
//   - API key storage via Electron's `safeStorage`, with a documented
//     plaintext fallback for platforms where the OS keychain is unavailable
//     (typically headless Linux without a keyring)
//   - building the env block injected into the spawned Next child
//
// Nothing in this module talks to a window or to IPC — it's pure config.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SETTINGS_FILE = "settings.json";
/** Repo root (parent of `electron/`) — stable regardless of process cwd. */
const PROJECT_ROOT = path.join(__dirname, "..");
const DEFAULT_PORT = 3765;
const FALLBACK_PORTS = [3766, 3767, 3768];
const SESSION_PARTITION = "persist:weatherv1";
const FIXED_HOST = "127.0.0.1";
const PRODUCTION_R2 = {
  enabled: true,
  gatewayUrl: "https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev",
  tenantId: "default",
  bucketName: "weatherv1-media",
};

let _userDataDir = null;
let _settings = null;

function setUserDataDir(dir) {
  _userDataDir = dir;
  _settings = null;
}

function getUserDataDir() {
  if (!_userDataDir) throw new Error("config: setUserDataDir() must be called first");
  return _userDataDir;
}

function settingsPath() {
  return path.join(getUserDataDir(), SETTINGS_FILE);
}

/**
 * Default app-managed local cache directory used in packaged builds when the
 * user hasn't explicitly chosen a workspace folder. The R2 catalog is the
 * source of truth; this folder just stores cached video files, posters,
 * uploads, and outputs.
 */
function defaultLocalCacheDir() {
  return path.join(getUserDataDir(), "local-cache");
}

function defaultDevWorkspaceDir() {
  return path.join(PROJECT_ROOT, "runtime", "workspace");
}

function defaultSettings() {
  return {
    workspaceDir: null,
    ffmpegPath: null,
    ffprobePath: null,
    // Stored as { scheme, data } objects (or null). `scheme` is "safe-storage"
    // for OS-keychain-encrypted values, "plaintext" otherwise.
    // `r2AppPassword` replaces the legacy `r2SessionToken`; the worker now
    // enforces HTTP Basic Auth with a username + password pair.
    keys: { openai: null, anthropic: null, gemini: null, r2AppPassword: null },
    // Plain-text user preference. "auto" lets the server pick from configured keys.
    llmProvider: "auto", // "auto" | "anthropic" | "openai"
    encryption: "none", // "safe-storage" | "none"
    r2: {
      enabled: false,
      gatewayUrl: null,
      tenantId: null,
      bucketName: null,
      // Username is non-secret; lives in the same r2 block alongside the
      // gateway URL. The matching password is encrypted under `keys`.
      appUsername: null,
    },
  };
}

function readSettings() {
  if (_settings) return _settings;
  const p = settingsPath();
  if (!fs.existsSync(p)) {
    _settings = defaultSettings();
    return _settings;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    _settings = {
      ...defaultSettings(),
      ...raw,
      keys: { ...defaultSettings().keys, ...(raw.keys || {}) },
      r2: { ...defaultSettings().r2, ...(raw.r2 || {}) },
    };
    // Drop legacy fields from older releases (whisper.cpp / ONNX local transcription).
    // We're cloud-only now; leaving them in env confuses the Next child.
    if ("transcriptionProvider" in _settings) delete _settings.transcriptionProvider;
    // Drop the legacy single-token credential. The worker now enforces
    // username + password Basic Auth; a stale token would silently fail.
    if (_settings.keys && "r2SessionToken" in _settings.keys) {
      delete _settings.keys.r2SessionToken;
    }
    return _settings;
  } catch {
    _settings = defaultSettings();
    return _settings;
  }
}

function writeSettings(next) {
  fs.mkdirSync(getUserDataDir(), { recursive: true });
  const current = readSettings();
  const merged = {
    ...current,
    ...next,
    keys: { ...current.keys, ...(next.keys || {}) },
    r2: { ...current.r2, ...(next.r2 || {}) },
  };
  const tmp = `${settingsPath()}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), "utf8");
  fs.renameSync(tmp, settingsPath());
  _settings = merged;
  return merged;
}

/**
 * Encrypt a secret using Electron's safeStorage when available; fall back to
 * plaintext on platforms that don't expose the OS keychain. The fallback is
 * deliberate — the alternative is "settings save silently fails on Linux
 * without a keyring," which would be worse UX. We record which scheme was
 * used in `settings.encryption` so the renderer can warn the user.
 *
 * @param {Buffer|string|null} value
 * @param {{ safeStorage?: any }} [opts]
 */
function encryptSecret(value, opts) {
  if (value == null || value === "") return null;
  const safeStorage = opts && opts.safeStorage;
  if (safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(String(value));
    return { scheme: "safe-storage", data: encrypted.toString("base64") };
  }
  return { scheme: "plaintext", data: String(value) };
}

function decryptSecret(stored, opts) {
  if (!stored) return null;
  const safeStorage = opts && opts.safeStorage;
  if (stored.scheme === "safe-storage") {
    if (!safeStorage || !safeStorage.isEncryptionAvailable || !safeStorage.isEncryptionAvailable()) {
      return null;
    }
    return safeStorage.decryptString(Buffer.from(stored.data, "base64"));
  }
  if (stored.scheme === "plaintext") return stored.data;
  return null;
}

/**
 * Build the env block passed to the spawned Next child. The child is the
 * only process that reads these vars — the renderer never sees them.
 *
 * @param {{
 *   port: number,
 *   token: string,
 *   ffmpeg: { ffmpegPath: string|null, ffprobePath: string|null },
 *   safeStorage?: any,
 *   productionMode?: boolean,
 * }} args
 */
function buildChildEnv(args) {
  const settings = readSettings();
  const openai = decryptSecret(settings.keys.openai, { safeStorage: args.safeStorage });
  const anthropic = decryptSecret(settings.keys.anthropic, { safeStorage: args.safeStorage });
  const gemini = decryptSecret(settings.keys.gemini, { safeStorage: args.safeStorage });
  const r2AppPassword = decryptSecret(settings.keys.r2AppPassword, { safeStorage: args.safeStorage });

  const env = {
    ...process.env,
    DESKTOP_MODE: "1",
    DESKTOP_SESSION_TOKEN: args.token,
    PORT: String(args.port),
    HOST: FIXED_HOST,
    NODE_ENV: process.env.NODE_ENV || "production",
  };

  // Packaged: explicit user workspace, else app-managed cache under userData.
  // Unpackaged dev: explicit user workspace, else in-repo `runtime/workspace`
  // (same R2-first layout as prod; no sibling v1Drive requirement).
  const workspaceDir = settings.workspaceDir && settings.workspaceDir.trim()
    ? settings.workspaceDir.trim()
    : (args.productionMode ? defaultLocalCacheDir() : defaultDevWorkspaceDir());
  if (workspaceDir) {
    env.WEATHER_WORKSPACE_DIR = workspaceDir;
    try {
      fs.mkdirSync(workspaceDir, { recursive: true });
    } catch (err) {
      console.warn(`[config] failed to ensure workspace dir ${workspaceDir}:`, err && err.message ? err.message : err);
    }
  }
  if (args.ffmpeg.ffmpegPath) env.FFMPEG_PATH = args.ffmpeg.ffmpegPath;
  if (args.ffmpeg.ffprobePath) env.FFPROBE_PATH = args.ffmpeg.ffprobePath;
  if (openai) env.OPENAI_API_KEY = openai;
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;
  if (gemini) env.GEMINI_API_KEY = gemini;

  env.WEATHER_USER_DATA_DIR = getUserDataDir();

  // Standalone Next cwd is `.next/standalone`; default `runtime/` would live
  // inside the app bundle and inherit any traced `jobs.json` seed. Sentinels
  // go under userData alongside R2 state paths.
  if (args.productionMode) {
    const serverRuntimeDir = path.join(getUserDataDir(), "server-runtime");
    env.WEATHER_RUNTIME_DIR = serverRuntimeDir;
    try {
      fs.mkdirSync(serverRuntimeDir, { recursive: true });
    } catch (err) {
      console.warn(
        `[config] failed to ensure server runtime dir ${serverRuntimeDir}:`,
        err && err.message ? err.message : err,
      );
    }
  }

  // In packaged builds Forge copies repo `assets/` into the app under
  // `Contents/Resources/`. The server uses this to locate the bundled
  // bg-music file (`bg-music/מוזיקת אנדר לתחזית.mp3`) regardless of the
  // user's workspace state.
  if (args.productionMode && process.resourcesPath) {
    env.WEATHER_RESOURCES_DIR = process.resourcesPath;
  }
  const fromSettings = settings.r2 || {};
  const r2 = args.productionMode
    ? { ...fromSettings, ...PRODUCTION_R2, enabled: true }
    : {
        ...PRODUCTION_R2,
        ...fromSettings,
        gatewayUrl: fromSettings.gatewayUrl || PRODUCTION_R2.gatewayUrl,
        tenantId: fromSettings.tenantId || PRODUCTION_R2.tenantId,
        bucketName: fromSettings.bucketName || PRODUCTION_R2.bucketName,
        enabled: Boolean(fromSettings.enabled),
      };
  if (r2.enabled && r2.gatewayUrl && r2.tenantId) {
    env.R2_SYNC_ENABLED = "1";
    env.R2_GATEWAY_URL = r2.gatewayUrl;
    env.R2_TENANT_ID = r2.tenantId;
    env.R2_STATE_PATH = path.join(getUserDataDir(), "r2-sync-state.json");
    if (r2.appUsername) env.R2_APP_USERNAME = r2.appUsername;
    if (r2AppPassword) env.R2_APP_PASSWORD = r2AppPassword;
    if (r2.bucketName) env.R2_BUCKET_NAME = r2.bucketName;
  }

  // LLM provider preference. "auto" leaves the env var unset so the server-side
  // selection falls through to the key-based default. Transcription is cloud-only
  // and selected entirely by OPENAI_API_KEY presence.
  if (settings.llmProvider && settings.llmProvider !== "auto") {
    env.LLM_PROVIDER = settings.llmProvider;
  }

  return env;
}

/** 32-byte hex token. Generated once per launch, lives in memory only. */
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

module.exports = {
  DEFAULT_PORT,
  FALLBACK_PORTS,
  SESSION_PARTITION,
  FIXED_HOST,
  PRODUCTION_R2,
  setUserDataDir,
  getUserDataDir,
  defaultLocalCacheDir,
  readSettings,
  writeSettings,
  encryptSecret,
  decryptSecret,
  buildChildEnv,
  generateSessionToken,
};
