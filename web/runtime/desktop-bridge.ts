// `window.desktop` for the browser build. The UI already talks to Electron
// through this bridge (settings, pickers, app info); here each call is backed
// by the File System Access API, IndexedDB and the in-memory fs.

import type { DesktopBridge, DesktopSettingsUpdate } from "@/shared/desktop";
import { pickFolder } from "./folder";
import { saveSettings } from "./settings";
import { checkForUpdate, updateState } from "./update";
import { webFs, WS, UPLOADS_DIR } from "./vfs";
import * as folder from "./folder";
import { registerExternal } from "./vfs";

declare const __WEATHERV1_VERSION__: string;

let editorToken: string | null = null;

async function pickOne(accept: Record<string, string[]>, description: string): Promise<File | null> {
  try {
    const [handle] = await window.showOpenFilePicker({ types: [{ description, accept }], multiple: false });
    return handle ? await handle.getFile() : null;
  } catch {
    return null; // cancelled
  }
}

export const webDesktopBridge: DesktopBridge = {
  async pickWorkspace() {
    try {
      const handle = await pickFolder();
      // A different folder means a different library: start over from it.
      setTimeout(() => window.location.reload(), 50);
      return { path: handle.name };
    } catch {
      return null;
    }
  },

  async pickAudioFile() {
    const file = await pickOne({ "audio/*": [".mp3", ".m4a", ".wav", ".ogg", ".mp4"] }, "קריינות");
    if (!file) return null;
    // The transcribe route copies from this path into uploads/.
    const vpath = `${UPLOADS_DIR}/picked/${Date.now()}-${file.name}`;
    webFs.mkdirSync(`${UPLOADS_DIR}/picked`, { recursive: true });
    webFs.writeFileSync(vpath, new Uint8Array(await file.arrayBuffer()));
    return { path: vpath, name: file.name };
  },

  async importCatalogVideo() {
    const file = await pickOne({ "video/*": [".mp4", ".mov", ".m4v"] }, "וידאו");
    if (!file) return null;
    // Large: stream straight into the folder's videos/ and record a placeholder.
    const w = await folder.openWritable(`videos/${file.name}`);
    await file.stream().pipeTo(w);
    const vpath = `${WS}/videos/${file.name}`;
    registerExternal(vpath, file.size);
    return { path: vpath, name: file.name };
  },

  async openPath() {
    return "";
  },

  async getAppInfo() {
    return {
      appVersion: __WEATHERV1_VERSION__,
      electronVersion: "web",
      nodeVersion: navigator.userAgent.match(/(Edg|Chrome)\/[\d.]+/)?.[0] ?? "browser",
      desktopMode: true,
      packaged: true,
      // Rendering runs on WebCodecs; the start-up gate already refused
      // browsers without H.264 encode, so the engine is always present here.
      ffmpeg: { ok: true, ffmpegPath: "WebCodecs", ffprobePath: "WebCodecs" },
    };
  },

  async getUpdateState() {
    void checkForUpdate();
    return updateState();
  },

  async saveSettings(update: DesktopSettingsUpdate) {
    const patch: Parameters<typeof saveSettings>[0] = {};
    if (typeof update.anthropicKey === "string" && update.anthropicKey.trim()) {
      patch.anthropicKey = update.anthropicKey.trim();
    }
    if (update.clearKeys?.includes("anthropic")) patch.anthropicKey = null;
    if (typeof update.planPipelineVer2 === "boolean") patch.planPipelineVer2 = update.planPipelineVer2;
    if (typeof update.workspaceDir === "string" && update.workspaceDir === "") {
      await this.pickWorkspace();
    }
    await saveSettings(patch);
    return { success: true };
  },

  async beginUninstall() {
    return { ok: false, reason: "בגרסת הדפדפן אין מה להסיר: מוחקים את התיקייה WeatherV1." };
  },

  async beginUninstallWithCleanup() {
    return this.beginUninstall();
  },

  async setEditorSession({ token }) {
    editorToken = token;
    return { success: true };
  },

  async getEditorSession() {
    return { token: editorToken };
  },

  async clearEditorSession() {
    editorToken = null;
    return { success: true };
  },
};
