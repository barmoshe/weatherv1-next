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
  ffmpeg: DesktopFfmpegInfo;
}

export type LlmProviderPreference = "auto" | "anthropic" | "openai";
export type TranscriptionProviderPreference =
  | "auto"
  | "local-whispercpp"
  | "openai-cloud";

export interface DesktopSettingsUpdate {
  workspaceDir?: string;
  openaiKey?: string;
  anthropicKey?: string;
  geminiKey?: string;
  ffmpegPath?: string;
  ffprobePath?: string;
  llmProvider?: LlmProviderPreference;
  transcriptionProvider?: TranscriptionProviderPreference;
}

export interface DesktopBridge {
  pickWorkspace(): Promise<DesktopWorkspacePick | null>;
  pickAudioFile(): Promise<DesktopFilePick | null>;
  importCatalogVideo(): Promise<DesktopFilePick | null>;
  openPath(targetPath: string): Promise<string>;
  getAppInfo(): Promise<DesktopAppInfo>;
  getUpdateState(): Promise<DesktopUpdateState>;
  saveSettings(update: DesktopSettingsUpdate): Promise<{ success: true }>;
}
