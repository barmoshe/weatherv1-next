// Electron main entrypoint.
//
// Lifecycle:
//   1. Verify ffmpeg/ffprobe using `electron/ffmpeg-verify.cjs`. We do this
//      before spawning the Next child because instrumentation.ts is not a
//      reliable boot gate under `node .next/standalone/server.js`
//      (vercel/next.js#89377).
//   2. Generate a per-launch 32-byte session token (never persisted).
//   3. Build the env block for the child from `electron/config.cjs`, which
//      pulls workspace path + decrypted API keys from `safeStorage`.
//   4. Spawn the Next child via `electron/server-manager.cjs`. Port picks
//      from {3765, 3766, 3767, 3768}; never an ephemeral port.
//   5. Wait for `/api/internal/health` to return 200 with the token header.
//   6. Open a BrowserWindow pinned to `session.fromPartition("persist:weatherv1")`.
//      That partition stays stable across port fallbacks, so localStorage
//      isn't orphaned.
//   7. Intercept the partition's `webRequest.onBeforeSendHeaders` and inject
//      the desktop token on requests to the loopback origin. The renderer
//      never holds the token directly.
//   8. Handle desktop:* IPC for the preload bridge (pickWorkspace,
//      pickAudioFile, importCatalogVideo, openPath, getAppInfo,
//      getUpdateState, saveSettings).

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { app, BrowserWindow, autoUpdater, dialog, ipcMain, session, shell, safeStorage } = require("electron");

// Windows Squirrel runs the installed app briefly during install/uninstall
// to fire `--squirrel-install`, `--squirrel-updated`, etc. The app MUST
// short-circuit on those flags or the installer hangs. No-op on macOS/Linux.
// Must run before `app.whenReady()`.
try {
  // eslint-disable-next-line global-require
  if (require("electron-squirrel-startup")) {
    app.quit();
  }
} catch {
  // electron-squirrel-startup isn't installed yet (Step 6 pins it). Skip.
}

const { verifyFFmpeg } = require("./ffmpeg-verify.cjs");
const cfg = require("./config.cjs");
const { createServerManager } = require("./server-manager.cjs");
const { isLoadableOrigin } = require("./window-utils.cjs");
const { runGoogleDriveOAuth } = require("./google-drive-oauth.cjs");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const IS_DEV = !app.isPackaged;

const state = {
  manager: null,
  token: null,
  origin: null,
  window: null,
  ffmpeg: null,
  bootstrapPromise: null,
  authInterceptorInstalled: false,
  updateState: { status: "unavailable", detail: "dev build — auto-update disabled" },
};

function wireAutoUpdater() {
  // `update-electron-app` is a thin wrapper over Electron's `autoUpdater`
  // that points the update feed at update.electronjs.org for
  // GitHub-published apps. Requires a signed app on both macOS and Windows;
  // no-ops on Linux.
  if (!app.isPackaged) return;
  let updateElectronApp;
  try {
    // eslint-disable-next-line global-require
    ({ updateElectronApp } = require("update-electron-app"));
  } catch {
    state.updateState = { status: "unavailable", detail: "update-electron-app not installed" };
    return;
  }
  try {
    updateElectronApp({ logger: console });
    state.updateState = { status: "configured" };
  } catch (err) {
    state.updateState = { status: "error", detail: err && err.message ? err.message : String(err) };
    return;
  }
  // Track autoUpdater events so `desktop:getUpdateState` reflects real state.
  autoUpdater.on("checking-for-update", () => {
    state.updateState = { status: "checking" };
  });
  autoUpdater.on("update-available", () => {
    state.updateState = { status: "available" };
  });
  autoUpdater.on("update-not-available", () => {
    state.updateState = { status: "idle" };
  });
  autoUpdater.on("update-downloaded", (_event, _notes, releaseName) => {
    state.updateState = { status: "downloaded", detail: releaseName };
  });
  autoUpdater.on("error", (err) => {
    state.updateState = { status: "error", detail: err && err.message ? err.message : String(err) };
  });
}

async function bootstrap() {
  cfg.setUserDataDir(app.getPath("userData"));

  state.ffmpeg = verifyFFmpeg();
  // Don't hard-fail on missing ffmpeg yet — the renderer's settings UI is
  // the right place to surface the error and let the user point us at a
  // binary. The render endpoints will refuse to operate anyway.

  state.token = cfg.generateSessionToken();

  const env = cfg.buildChildEnv({
    port: cfg.DEFAULT_PORT,
    token: state.token,
    ffmpeg: { ffmpegPath: state.ffmpeg.ffmpegPath, ffprobePath: state.ffmpeg.ffprobePath },
    safeStorage,
  });

  state.manager = createServerManager({
    projectRoot: PROJECT_ROOT,
    mode: IS_DEV ? "dev" : "prod",
    token: state.token,
    env,
    logPath: IS_DEV ? null : path.join(app.getPath("userData"), "logs", "next-child.log"),
    onExit: ({ code, signal }) => {
      console.warn(`[main] Next child exited unexpectedly (code=${code} signal=${signal})`);
      // If the window is still open, surface a clear dialog rather than
      // leaving a blank renderer. v1 just notifies; auto-restart is a
      // policy call for later.
      if (state.window && !state.window.isDestroyed()) {
        dialog.showErrorBox(
          "Background server stopped",
          "The local Next server exited unexpectedly. Restart the app.",
        );
      }
    },
  });

  const { origin } = await state.manager.start();
  state.origin = origin;

  installAuthInterceptor();
  openMainWindow();
  wireAutoUpdater();
}

function ensureBootstrapped() {
  if (!state.bootstrapPromise) {
    state.bootstrapPromise = bootstrap().catch((err) => {
      state.bootstrapPromise = null;
      throw err;
    });
  }
  return state.bootstrapPromise;
}

function installAuthInterceptor() {
  if (state.authInterceptorInstalled) return;
  const sess = session.fromPartition(cfg.SESSION_PARTITION);
  // Inject the token on every loopback request from the renderer. The token
  // never leaves main; the renderer doesn't see it.
  sess.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    if (state.token && isLoadableOrigin(state.origin) && details.url.startsWith(state.origin)) {
      requestHeaders["x-weather-desktop-token"] = state.token;
    }
    callback({ requestHeaders });
  });
  state.authInterceptorInstalled = true;
}

function openMainWindow() {
  if (state.window && !state.window.isDestroyed()) {
    state.window.focus();
    return;
  }
  if (!isLoadableOrigin(state.origin)) {
    console.warn(`[main] refusing to open BrowserWindow without a valid origin: ${state.origin}`);
    return;
  }

  state.window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    // Dock / taskbar icon. Forge bakes the icon into the .app / .exe bundle at
    // package time, but setting it here makes the icon appear in the macOS
    // Dock and Windows taskbar during `npm run electron:dev` too.
    icon: path.join(
      __dirname,
      process.platform === "win32" ? "../build/icon.ico" : "../build/icon.icns",
    ),
    webPreferences: {
      partition: cfg.SESSION_PARTITION,
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  state.window.once("ready-to-show", () => state.window.show());
  state.window.webContents.setWindowOpenHandler(({ url }) => {
    // Default: open external links in the user's default browser, never in
    // a new Electron window. (Security checklist item 13.)
    shell.openExternal(url);
    return { action: "deny" };
  });
  state.window.loadURL(state.origin);
}

// ---- IPC handlers --------------------------------------------------------

ipcMain.handle("desktop:pickWorkspace", async () => {
  const result = await dialog.showOpenDialog(state.window, {
    title: "Choose workspace folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { path: result.filePaths[0] };
});

ipcMain.handle("desktop:pickAudioFile", async () => {
  const result = await dialog.showOpenDialog(state.window, {
    title: "Choose audio file",
    properties: ["openFile"],
    filters: [{ name: "Audio", extensions: ["mp3", "wav", "m4a", "aac", "flac", "ogg"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
});

ipcMain.handle("desktop:importCatalogVideo", async () => {
  const result = await dialog.showOpenDialog(state.window, {
    title: "Choose video file",
    properties: ["openFile"],
    filters: [{ name: "Video", extensions: ["mp4", "mov"] }],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return { path: result.filePaths[0], name: path.basename(result.filePaths[0]) };
});

ipcMain.handle("desktop:openPath", async (_e, targetPath) => {
  if (typeof targetPath !== "string") return "invalid-path";
  if (!fs.existsSync(targetPath)) return "missing";
  return shell.openPath(targetPath);
});

ipcMain.handle("desktop:getAppInfo", async () => ({
  appVersion: app.getVersion(),
  electronVersion: process.versions.electron,
  nodeVersion: process.versions.node,
  desktopMode: true,
  ffmpeg: {
    ok: state.ffmpeg?.ok ?? false,
    ffmpegPath: state.ffmpeg?.ffmpegPath ?? null,
    ffprobePath: state.ffmpeg?.ffprobePath ?? null,
    error: state.ffmpeg && state.ffmpeg.errors.length > 0 ? state.ffmpeg.errors.join("\n") : undefined,
  },
}));

ipcMain.handle("desktop:getUpdateState", async () => state.updateState);

async function restartChildWithCurrentSettings() {
  const env = cfg.buildChildEnv({
    port: cfg.DEFAULT_PORT,
    token: state.token,
    ffmpeg: { ffmpegPath: state.ffmpeg.ffmpegPath, ffprobePath: state.ffmpeg.ffprobePath },
    safeStorage,
  });
  await state.manager.restart(env);
  if (state.window && !state.window.isDestroyed()) {
    const nextOrigin = state.manager.origin;
    if (isLoadableOrigin(nextOrigin)) {
      state.origin = nextOrigin;
      state.window.loadURL(nextOrigin);
    } else {
      console.warn(`[main] restart finished without a valid origin: ${nextOrigin}`);
    }
  }
}

ipcMain.handle("desktop:connectGoogleDrive", async () => {
  const settings = cfg.readSettings();
  const clientId =
    (settings.googleDrive && settings.googleDrive.clientId) ||
    process.env.GOOGLE_CLIENT_ID ||
    null;
  if (!clientId) {
    throw new Error("Set a Google OAuth desktop client ID before connecting Drive");
  }

  const tokens = await runGoogleDriveOAuth({
    clientId,
    openExternal: (url) => shell.openExternal(url),
  });
  if (!tokens.refresh_token) {
    throw new Error("Google did not return a refresh token. Revoke app access and try connecting again.");
  }

  cfg.writeSettings({
    googleDrive: { enabled: true, clientId },
    keys: {
      googleDriveRefreshToken: cfg.encryptSecret(tokens.refresh_token, { safeStorage }),
    },
    encryption: safeStorage.isEncryptionAvailable() ? "safe-storage" : "none",
  });

  await restartChildWithCurrentSettings();
  return { success: true };
});

ipcMain.handle("desktop:saveSettings", async (_e, update) => {
  const patch = {};
  if (update && typeof update.workspaceDir === "string") patch.workspaceDir = update.workspaceDir;
  if (update && typeof update.ffmpegPath === "string") patch.ffmpegPath = update.ffmpegPath;
  if (update && typeof update.ffprobePath === "string") patch.ffprobePath = update.ffprobePath;

  const llmProviders = new Set(["auto", "anthropic", "openai"]);
  const transcriptionProviders = new Set(["auto", "local-whispercpp", "openai-cloud"]);
  if (update && typeof update.llmProvider === "string" && llmProviders.has(update.llmProvider)) {
    patch.llmProvider = update.llmProvider;
  }
  if (
    update &&
    typeof update.transcriptionProvider === "string" &&
    transcriptionProviders.has(update.transcriptionProvider)
  ) {
    patch.transcriptionProvider = update.transcriptionProvider;
  }
  if (update && typeof update.googleClientId === "string") {
    patch.googleDrive = {
      ...(patch.googleDrive || {}),
      clientId: update.googleClientId.trim() || null,
    };
  }
  if (update && typeof update.googleDriveEnabled === "boolean") {
    patch.googleDrive = {
      ...(patch.googleDrive || {}),
      enabled: update.googleDriveEnabled,
    };
  }

  const keyUpdates = {};
  if (update && typeof update.openaiKey === "string") {
    keyUpdates.openai = cfg.encryptSecret(update.openaiKey, { safeStorage });
  }
  if (update && typeof update.anthropicKey === "string") {
    keyUpdates.anthropic = cfg.encryptSecret(update.anthropicKey, { safeStorage });
  }
  if (update && typeof update.geminiKey === "string") {
    keyUpdates.gemini = cfg.encryptSecret(update.geminiKey, { safeStorage });
  }
  if (Object.keys(keyUpdates).length > 0) patch.keys = keyUpdates;

  // Reflect the encryption scheme actually used so the renderer can show
  // a "stored in OS keychain" vs "stored as plaintext" indicator.
  patch.encryption = safeStorage.isEncryptionAvailable() ? "safe-storage" : "none";

  cfg.writeSettings(patch);

  // Restart the child with the new env. The renderer is expected to show a
  // brief "Reloading…" overlay while the new instance comes up.
  await restartChildWithCurrentSettings();

  return { success: true };
});

// ---- App lifecycle -------------------------------------------------------

app.whenReady().then(() => {
  ensureBootstrapped().catch((err) => {
    console.error("[main] bootstrap failed", err);
    dialog.showErrorBox("Failed to start", err && err.message ? err.message : String(err));
    app.quit();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    if (state.manager) state.manager.kill();
    app.quit();
  }
});

app.on("before-quit", () => {
  if (state.manager) state.manager.kill();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    ensureBootstrapped()
      .then(() => openMainWindow())
      .catch((err) => {
        console.error("[main] activate failed", err);
        dialog.showErrorBox("Failed to open", err && err.message ? err.message : String(err));
      });
  }
});
