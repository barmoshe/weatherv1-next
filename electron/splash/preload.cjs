// Tiny preload bridge for the first-launch splash window.
//
// Only exposes `window.splash.done()`. The main process listens for that one
// signal (or falls back to a hard timeout) before closing the splash and
// opening the main BrowserWindow. Kept narrow on purpose — splash HTML is
// local but should still ride contextIsolation:true / sandbox:true rules.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("splash", {
  done: () => ipcRenderer.send("splash:done"),
});
