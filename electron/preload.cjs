// Preload bridge. Runs in the renderer's isolated context and exposes a
// narrow surface as `window.desktop`. The shape matches the
// `DesktopBridge` interface declared in `src/shared/desktop.ts`.
//
// Important: this is the only place where the renderer can reach IPC.
// `contextIsolation: true` + `nodeIntegration: false` are set in main, so
// without this bridge the renderer has zero access to Node, the filesystem,
// the desktop session token, or the spawned server's env.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const bridge = {
  pickWorkspace: () => ipcRenderer.invoke("desktop:pickWorkspace"),
  pickAudioFile: () => ipcRenderer.invoke("desktop:pickAudioFile"),
  importCatalogVideo: () => ipcRenderer.invoke("desktop:importCatalogVideo"),
  openPath: (targetPath) => ipcRenderer.invoke("desktop:openPath", targetPath),
  getAppInfo: () => ipcRenderer.invoke("desktop:getAppInfo"),
  getUpdateState: () => ipcRenderer.invoke("desktop:getUpdateState"),
  saveSettings: (update) => ipcRenderer.invoke("desktop:saveSettings", update),
  beginUninstall: () => ipcRenderer.invoke("desktop:beginUninstall"),
  beginUninstallWithCleanup: () => ipcRenderer.invoke("desktop:beginUninstallWithCleanup"),
  setEditorSession: (payload) => ipcRenderer.invoke("desktop:setEditorSession", payload),
  getEditorSession: () => ipcRenderer.invoke("desktop:getEditorSession"),
  clearEditorSession: () => ipcRenderer.invoke("desktop:clearEditorSession"),
};

contextBridge.exposeInMainWorld("desktop", bridge);
