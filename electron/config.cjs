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
const DEFAULT_PORT = 3765;
const FALLBACK_PORTS = [3766, 3767, 3768];
const SESSION_PARTITION = "persist:weatherv1";
const FIXED_HOST = "127.0.0.1";

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

function defaultSettings() {
  return {
    workspaceDir: null,
    ffmpegPath: null,
    ffprobePath: null,
    // Stored as { scheme, data } objects (or null). `scheme` is "safe-storage"
    // for OS-keychain-encrypted values, "plaintext" otherwise.
    keys: { openai: null, anthropic: null, gemini: null, googleDriveRefreshToken: null },
    // Plain-text user preference. "auto" lets the server pick from configured keys.
    llmProvider: "auto", // "auto" | "anthropic" | "openai"
    encryption: "none", // "safe-storage" | "none"
    googleDrive: {
      enabled: false,
      clientId: null,
      rootFolderId: null,
      catalogFileId: null,
      lastKnownModifiedTime: null,
      lastKnownMd5Checksum: null,
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
      googleDrive: { ...defaultSettings().googleDrive, ...(raw.googleDrive || {}) },
    };
    // Drop legacy fields from older releases (whisper.cpp / ONNX local transcription).
    // We're cloud-only now; leaving them in env confuses the Next child.
    if ("transcriptionProvider" in _settings) delete _settings.transcriptionProvider;
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
    googleDrive: { ...current.googleDrive, ...(next.googleDrive || {}) },
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
 * }} args
 */
function buildChildEnv(args) {
  const settings = readSettings();
  const openai = decryptSecret(settings.keys.openai, { safeStorage: args.safeStorage });
  const anthropic = decryptSecret(settings.keys.anthropic, { safeStorage: args.safeStorage });
  const gemini = decryptSecret(settings.keys.gemini, { safeStorage: args.safeStorage });
  const googleDriveRefreshToken = decryptSecret(settings.keys.googleDriveRefreshToken, {
    safeStorage: args.safeStorage,
  });

  const env = {
    ...process.env,
    DESKTOP_MODE: "1",
    DESKTOP_SESSION_TOKEN: args.token,
    PORT: String(args.port),
    HOST: FIXED_HOST,
    NODE_ENV: process.env.NODE_ENV || "production",
  };

  if (settings.workspaceDir) env.WEATHER_WORKSPACE_DIR = settings.workspaceDir;
  if (args.ffmpeg.ffmpegPath) env.FFMPEG_PATH = args.ffmpeg.ffmpegPath;
  if (args.ffmpeg.ffprobePath) env.FFPROBE_PATH = args.ffmpeg.ffprobePath;
  if (openai) env.OPENAI_API_KEY = openai;
  if (anthropic) env.ANTHROPIC_API_KEY = anthropic;
  if (gemini) env.GEMINI_API_KEY = gemini;

  env.WEATHER_USER_DATA_DIR = getUserDataDir();
  if (settings.googleDrive.enabled && settings.googleDrive.clientId && googleDriveRefreshToken) {
    env.GOOGLE_DRIVE_CATALOG = "1";
    env.GOOGLE_CLIENT_ID = settings.googleDrive.clientId;
    env.GOOGLE_REFRESH_TOKEN = googleDriveRefreshToken;
    env.GOOGLE_DRIVE_STATE_PATH = path.join(getUserDataDir(), "google-drive-catalog-state.json");
    if (settings.googleDrive.rootFolderId) env.GOOGLE_DRIVE_ROOT_FOLDER_ID = settings.googleDrive.rootFolderId;
    if (settings.googleDrive.catalogFileId) env.GOOGLE_DRIVE_CATALOG_FILE_ID = settings.googleDrive.catalogFileId;
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
  setUserDataDir,
  getUserDataDir,
  readSettings,
  writeSettings,
  encryptSecret,
  decryptSecret,
  buildChildEnv,
  generateSessionToken,
};
