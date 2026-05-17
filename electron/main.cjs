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
//      getUpdateState, saveSettings, beginUninstall).

"use strict";

const path = require("node:path");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const { app, BrowserWindow, autoUpdater, dialog, ipcMain, session, shell, safeStorage } = require("electron");
const { buildWindowsCleanupCmd } = require("./uninstall-utils.cjs");

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

  // Branded first-launch splash. Fire-and-forget: any failure here must not
  // block the main bootstrap path. Awaited so the main window opens after.
  await maybeShowSplash().catch((err) => {
    console.warn("[main] splash failed:", err && err.message ? err.message : err);
  });

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
    productionMode: app.isPackaged,
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

/**
 * Show a branded splash window once per (installed) app version.
 *
 * Splash lives at `electron/splash/splash.html` with a tiny preload that
 * exposes `window.splash.done()` — the page calls it when the intro
 * animation has had time to play. A 4 s hard cap covers anything that
 * silently breaks (CSP, file IO, GPU) so the main window always opens.
 */
async function maybeShowSplash() {
  const settings = cfg.readSettings();
  if (settings.splashShownForVersion === app.getVersion()) return;

  const splash = new BrowserWindow({
    width: 520,
    height: 320,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "splash", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splash.once("ready-to-show", () => splash.show());

  try {
    await splash.loadFile(path.join(__dirname, "splash", "splash.html"));
  } catch (err) {
    console.warn("[main] splash loadFile failed:", err && err.message ? err.message : err);
    if (!splash.isDestroyed()) splash.destroy();
    return;
  }

  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener("splash:done", finish);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 4000);
    ipcMain.once("splash:done", finish);
    splash.once("closed", finish);
  });

  if (!splash.isDestroyed()) splash.close();

  try {
    cfg.writeSettings({ splashShownForVersion: app.getVersion() });
  } catch (err) {
    // Non-fatal — splash just re-shows next launch.
    console.warn("[main] splash flag write failed:", err && err.message ? err.message : err);
  }
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
  packaged: app.isPackaged,
  ffmpeg: {
    ok: state.ffmpeg?.ok ?? false,
    ffmpegPath: state.ffmpeg?.ffmpegPath ?? null,
    ffprobePath: state.ffmpeg?.ffprobePath ?? null,
    error: state.ffmpeg && state.ffmpeg.errors.length > 0 ? state.ffmpeg.errors.join("\n") : undefined,
  },
}));

ipcMain.handle("desktop:getUpdateState", async () => state.updateState);

ipcMain.handle("desktop:beginUninstallWithCleanup", async () => {
  if (!app.isPackaged) {
    return { ok: false, reason: "זמין רק בגרסה ארוזה." };
  }

  const parentWindow = state.window && !state.window.isDestroyed() ? state.window : null;
  const showBox = (opts) =>
    parentWindow ? dialog.showMessageBox(parentWindow, opts) : dialog.showMessageBox(opts);

  const userData = app.getPath("userData");
  const detail =
    "האפליקציה תיסגר, יימחקו כל הנתונים המקומיים (מפתחות API, הגדרות, סשנים, יומנים) " +
    `מהנתיב:\n${userData}\n\nתיקיית הסביבה (workspace) שבחרת לא תיגע — מחק אותה ידנית במידת הצורך.`;

  if (process.platform === "win32") {
    const updateExe = path.join(path.dirname(process.execPath), "..", "Update.exe");
    if (!fs.existsSync(updateExe)) {
      await shell.openExternal("ms-settings:appsfeatures");
      return {
        ok: false,
        reason: "לא נמצא מסיר ההתקנה. נפתחו הגדרות יישומים — ניתן להסיר את WeatherV1 משם.",
      };
    }

    const { response } = await showBox({
      type: "warning",
      buttons: ["ביטול", "הסר וניקוי מלא"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "הסרת WeatherV1 וניקוי כל הנתונים?",
      detail,
    });
    if (response !== 1) {
      return { ok: false, reason: "בוטל" };
    }

    // Spawn a detached cmd that waits for the app to exit, wipes userData, then
    // runs the Squirrel uninstaller. windowsVerbatimArguments lets us pass the
    // composite "& "-chained command line through cmd /c without re-quoting.
    const cmdLine = buildWindowsCleanupCmd(userData, updateExe);
    const child = spawn("cmd.exe", ["/c", cmdLine], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      windowsVerbatimArguments: true,
    });
    child.unref();
    setImmediate(() => {
      app.quit();
    });
    return { ok: true };
  }

  if (process.platform === "darwin") {
    const { response } = await showBox({
      type: "warning",
      buttons: ["ביטול", "מחק נתונים ופתח Finder"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "הסרת WeatherV1 וניקוי כל הנתונים?",
      detail,
    });
    if (response !== 1) {
      return { ok: false, reason: "בוטל" };
    }

    try {
      fs.rmSync(userData, { recursive: true, force: true });
    } catch (e) {
      return { ok: false, reason: `מחיקת נתונים נכשלה: ${e instanceof Error ? e.message : String(e)}` };
    }

    const bundlePath = path.join(path.dirname(process.execPath), "..", "..");
    shell.showItemInFolder(bundlePath);
    return { ok: true };
  }

  await showBox({
    type: "info",
    buttons: ["אישור"],
    defaultId: 0,
    noLink: true,
    message: "הסרת האפליקציה",
    detail: `מחק את תיקיית ההתקנה ידנית, וכן את:\n${userData}`,
  });
  return { ok: true };
});

ipcMain.handle("desktop:beginUninstall", async () => {
  if (!app.isPackaged) {
    return { ok: false, reason: "זמין רק בגרסה ארוזה." };
  }

  const parentWindow = state.window && !state.window.isDestroyed() ? state.window : null;
  const showBox = (opts) =>
    parentWindow ? dialog.showMessageBox(parentWindow, opts) : dialog.showMessageBox(opts);

  if (process.platform === "win32") {
    const updateExe = path.join(path.dirname(process.execPath), "..", "Update.exe");
    if (!fs.existsSync(updateExe)) {
      await shell.openExternal("ms-settings:appsfeatures");
      return {
        ok: false,
        reason: "לא נמצא מסיר ההתקנה. נפתחו הגדרות יישומים — ניתן להסיר את WeatherV1 משם.",
      };
    }

    const { response } = await showBox({
      type: "warning",
      buttons: ["ביטול", "הסר התקנה"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "להסיר את WeatherV1 מהמחשב?",
      detail: "האפליקציה תיסגר ויופעל מסיר ההתקנה של Windows.",
    });
    if (response !== 1) {
      return { ok: false, reason: "בוטל" };
    }

    const child = spawn(updateExe, ["--uninstall"], { detached: true, stdio: "ignore" });
    child.unref();
    setImmediate(() => {
      app.quit();
    });
    return { ok: true };
  }

  if (process.platform === "darwin") {
    const userData = app.getPath("userData");
    const { response } = await showBox({
      type: "warning",
      buttons: ["ביטול", "פתח ב-Finder"],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
      message: "הסרת WeatherV1",
      detail: `לאחר סגירת האפליקציה, גרור את WeatherV1.app לסל המחזור.\nנתונים מקומיים עלולים להישאר ב:\n${userData}`,
    });
    if (response !== 1) {
      return { ok: false, reason: "בוטל" };
    }

    const bundlePath = path.join(path.dirname(process.execPath), "..", "..");
    shell.showItemInFolder(bundlePath);
    return { ok: true };
  }

  await showBox({
    type: "info",
    buttons: ["אישור"],
    defaultId: 0,
    noLink: true,
    message: "הסרת האפליקציה",
    detail: "מחק את תיקיית ההתקנה של WeatherV1 מהמחשב. נתונים מקומיים עלולים להישאר בתיקיית הנתונים של האפליקציה.",
  });
  return { ok: true };
});

async function restartChildWithCurrentSettings() {
  const env = cfg.buildChildEnv({
    port: cfg.DEFAULT_PORT,
    token: state.token,
    ffmpeg: { ffmpegPath: state.ffmpeg.ffmpegPath, ffprobePath: state.ffmpeg.ffprobePath },
    safeStorage,
    productionMode: app.isPackaged,
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

ipcMain.handle("desktop:setEditorSession", async (_e, payload) => {
  const token = payload && typeof payload.token === "string" ? payload.token : null;
  if (!token || token.length !== 64) {
    return { success: false, error: "Invalid token" };
  }
  cfg.saveEditorSessionToken(token, { safeStorage });
  // Restart the child server so the new token gets injected into the
  // child's env and seeds its in-memory editor-token set.
  await restartChildWithCurrentSettings();
  return { success: true };
});

ipcMain.handle("desktop:getEditorSession", async () => {
  const token = cfg.loadEditorSessionToken({ safeStorage });
  return { token: token || null };
});

ipcMain.handle("desktop:clearEditorSession", async () => {
  cfg.clearEditorSessionToken();
  await restartChildWithCurrentSettings();
  return { success: true };
});

ipcMain.handle("desktop:saveSettings", async (_e, update) => {
  const patch = {};
  if (update && typeof update.workspaceDir === "string") {
    // Empty string means "clear" — fall back to the app-managed local cache
    // in packaged builds. Trim and normalize null vs string.
    const trimmed = update.workspaceDir.trim();
    patch.workspaceDir = trimmed.length > 0 ? trimmed : null;
  }
  if (update && typeof update.ffmpegPath === "string") patch.ffmpegPath = update.ffmpegPath;
  if (update && typeof update.ffprobePath === "string") patch.ffprobePath = update.ffprobePath;

  const llmProviders = new Set(["auto", "anthropic", "openai"]);
  if (update && typeof update.llmProvider === "string" && llmProviders.has(update.llmProvider)) {
    patch.llmProvider = update.llmProvider;
  }
  if (update && typeof update.r2Enabled === "boolean") {
    patch.r2 = { ...(patch.r2 || {}), enabled: update.r2Enabled };
  }
  if (update && typeof update.r2GatewayUrl === "string") {
    patch.r2 = { ...(patch.r2 || {}), gatewayUrl: update.r2GatewayUrl.trim() || null };
  }
  if (update && typeof update.r2TenantId === "string") {
    patch.r2 = { ...(patch.r2 || {}), tenantId: update.r2TenantId.trim() || null };
  }
  if (update && typeof update.r2BucketName === "string") {
    patch.r2 = { ...(patch.r2 || {}), bucketName: update.r2BucketName.trim() || null };
  }
  if (update && typeof update.r2AppUsername === "string") {
    patch.r2 = { ...(patch.r2 || {}), appUsername: update.r2AppUsername.trim() || null };
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
  if (update && typeof update.r2AppPassword === "string") {
    keyUpdates.r2AppPassword = cfg.encryptSecret(update.r2AppPassword, { safeStorage });
  }
  if (update && Array.isArray(update.clearKeys)) {
    if (update.clearKeys.includes("openai")) keyUpdates.openai = null;
    if (update.clearKeys.includes("anthropic")) keyUpdates.anthropic = null;
    if (update.clearKeys.includes("gemini")) keyUpdates.gemini = null;
    // "r2" clears the password (the username stays in the r2 block until the
    // user explicitly blanks it; that's intentional — username is rarely the
    // thing that needs rotating).
    if (update.clearKeys.includes("r2")) keyUpdates.r2AppPassword = null;
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
