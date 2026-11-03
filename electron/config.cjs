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
// Non-secret connection fallbacks for the opt-in cloud sync. Credentials
// are never baked into builds; they come from Settings → Cloud (or env).
const PRODUCTION_R2 = {
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
    // Since v0.7.0 the app needs only the Claude key; transcription is local.
    keys: { anthropic: null, r2AppPassword: null },
    // /api/plan pipeline selection. true = retrieve-then-pick ver2 (default
    // since v0.4.0). false = original validator-based ver1. The selection is
    // injected as PLAN_PIPELINE_VER2={1,0} for the Next child.
    planPipelineVer2: true,
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
    // App version the first-launch splash has already been shown for.
    // `null` (or a mismatch with `app.getVersion()`) re-arms the splash.
    splashShownForVersion: null,
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
    // Drop legacy fields from older releases: the May transcription-provider
    // pick, and (v0.7.0) the OpenAI/Gemini keys and the LLM provider pick, so
    // an upgraded install keeps no secret it no longer uses.
    if ("transcriptionProvider" in _settings) delete _settings.transcriptionProvider;
    if ("llmProvider" in _settings) delete _settings.llmProvider;
    if (_settings.keys) {
      delete _settings.keys.openai;
      delete _settings.keys.gemini;
    }
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
  const anthropic = decryptSecret(settings.keys.anthropic, { safeStorage: args.safeStorage });
  // R2 Worker Basic-auth password for the opt-in sync. Precedence:
  // process.env wins so a rotated secret in .env / shell is picked up
  // immediately; persisted settings are the packaged-app path. Never baked
  // into builds.
  const r2AppPassword =
    process.env.EDITOR_PASSWORD ||
    decryptSecret(settings.keys.r2AppPassword, { safeStorage: args.safeStorage }) ||
    null;

  const editorSessionToken = loadEditorSessionToken({ safeStorage: args.safeStorage });

  const env = {
    ...process.env,
    DESKTOP_MODE: "1",
    DESKTOP_SESSION_TOKEN: args.token,
    PORT: String(args.port),
    HOST: FIXED_HOST,
    NODE_ENV: process.env.NODE_ENV || "production",
  };

  // Seed the child server's in-memory editor-token set with the
  // persisted token so a quit+relaunch keeps the editor signed in.
  // Empty string when no persisted token exists (first launch / after
  // sign-out); the child treats absence as "no seed" and waits for a
  // fresh login to mint one.
  if (editorSessionToken) {
    env.WEATHER_EDITOR_SESSION_TOKEN = editorSessionToken;
  }

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
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;

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
  const fromSettings = { ...(settings.r2 || {}) };
  // Same fall-back for the username so a dev shell matches the env-provided
  // password (otherwise the gateway sees user=null and 401s).
  if (!fromSettings.appUsername) {
    fromSettings.appUsername = process.env.R2_APP_USERNAME || null;
  }
  // Local storage is the default in every mode; R2 sync is an explicit
  // opt-in from Settings. PRODUCTION_R2 only fills in gateway/tenant/bucket
  // when the user enables sync without overriding them.
  const r2 = {
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
    if (r2AppPassword) env.EDITOR_PASSWORD = r2AppPassword;
    if (r2.bucketName) env.R2_BUCKET_NAME = r2.bucketName;
  } else {
    // Settings are authoritative over inherited env: `env` starts as a copy
    // of process.env, and a leftover R2_SYNC_ENABLED=1 from .env / the shell
    // would silently force cloud mode while the Settings checkbox shows off.
    delete env.R2_SYNC_ENABLED;
    delete env.R2_GATEWAY_URL;
    delete env.R2_TENANT_ID;
    delete env.R2_STATE_PATH;
    delete env.R2_BUCKET_NAME;
    delete env.R2_APP_USERNAME;
  }

  // Plan-pipeline preference. Default is ver2 since v0.4.0 — always emit the
  // env so toggling off in the admin panel ("0") actually reaches the child.
  env.PLAN_PIPELINE_VER2 = settings.planPipelineVer2 === false ? "0" : "1";

  return env;
}

/** 32-byte hex token. Generated once per launch, lives in memory only. */
function generateSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

// Editor session token — persisted across launches so the editor stays
// signed in until they hit "Sign out". Stored alongside settings.json
// in userData/. Same encryption scheme as API keys (safeStorage when
// available, plaintext fallback for headless-Linux).
const EDITOR_SESSION_FILE = "editorSessionToken.json";

function editorSessionPath() {
  return path.join(getUserDataDir(), EDITOR_SESSION_FILE);
}

function loadEditorSessionToken(opts) {
  const p = editorSessionPath();
  if (!fs.existsSync(p)) return null;
  try {
    const stored = JSON.parse(fs.readFileSync(p, "utf8"));
    const token = decryptSecret(stored, opts);
    if (typeof token === "string" && token.length === 64) return token;
    return null;
  } catch {
    return null;
  }
}

function saveEditorSessionToken(token, opts) {
  if (typeof token !== "string" || token.length !== 64) {
    throw new Error("saveEditorSessionToken: expected 64-hex token");
  }
  fs.mkdirSync(getUserDataDir(), { recursive: true });
  const stored = encryptSecret(token, opts);
  const tmp = `${editorSessionPath()}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(stored), "utf8");
  fs.renameSync(tmp, editorSessionPath());
}

function clearEditorSessionToken() {
  const p = editorSessionPath();
  if (fs.existsSync(p)) fs.unlinkSync(p);
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
  loadEditorSessionToken,
  saveEditorSessionToken,
  clearEditorSessionToken,
};
