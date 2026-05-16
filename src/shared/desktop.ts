export interface DesktopFilePick {
  path: string;
  name: string;
}

export interface DesktopWorkspacePick {
  path: string;
}

export interface DesktopUpdateState {
  status: "idle" | "configured" | "checking" | "available" | "downloading" | "downloaded" | "error" | "unavailable";
  detail?: string;
}

export interface DesktopFfmpegInfo {
  ok: boolean;
  ffmpegPath?: string | null;
  ffprobePath?: string | null;
  error?: string;
}

export interface DesktopAppInfo {
  appVersion: string;
  electronVersion: string;
  nodeVersion: string;
  desktopMode: boolean;
  packaged?: boolean;
  ffmpeg: DesktopFfmpegInfo;
}

export type LlmProviderPreference = "auto" | "anthropic" | "openai";

export interface DesktopSettingsUpdate {
  workspaceDir?: string;
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
  /**
   * Wipes the matching stored credential. "r2" clears the R2 password only
   * (the username is non-secret and stays put until edited explicitly).
   */
  clearKeys?: ("openai" | "anthropic" | "gemini" | "r2")[];
  ffmpegPath?: string;
  ffprobePath?: string;
  llmProvider?: LlmProviderPreference;
  r2Enabled?: boolean;
  r2GatewayUrl?: string;
  r2TenantId?: string;
  r2BucketName?: string;
  r2AppUsername?: string;
  r2AppPassword?: string;
}

export interface DesktopBeginUninstallResult {
  ok: boolean;
  reason?: string;
}

export interface DesktopBridge {
  pickWorkspace(): Promise<DesktopWorkspacePick | null>;
  pickAudioFile(): Promise<DesktopFilePick | null>;
  importCatalogVideo(): Promise<DesktopFilePick | null>;
  openPath(targetPath: string): Promise<string>;
  getAppInfo(): Promise<DesktopAppInfo>;
  getUpdateState(): Promise<DesktopUpdateState>;
  saveSettings(update: DesktopSettingsUpdate): Promise<{ success: true }>;
  beginUninstall(): Promise<DesktopBeginUninstallResult>;
  setEditorSession(payload: { token: string }): Promise<{ success: boolean; error?: string }>;
  getEditorSession(): Promise<{ token: string | null }>;
  clearEditorSession(): Promise<{ success: true }>;
}
