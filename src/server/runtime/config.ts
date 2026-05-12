import path from "node:path";

export interface WeatherRuntimeConfig {
  projectRoot: string;
  desktopMode: boolean;
  desktopSessionToken: string | null;
  workspaceDir: string;
  catalogPath: string;
  videosDir: string;
  musicDir: string;
  runtimeDir: string;
  userDataDir: string | null;
  ffmpegPath?: string;
  ffprobePath?: string;
  bgMusicPath: string;
}

let cachedConfig: WeatherRuntimeConfig | null = null;

function normalizeOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveFrom(baseDir: string, value: string | undefined): string | undefined {
  const trimmed = normalizeOptional(value);
  if (!trimmed) return undefined;
  return path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
}

function defaultWorkspaceDir(projectRoot: string): string {
  return path.resolve(projectRoot, "..", "v1Drive", "weather");
}

function defaultRuntimeDir(projectRoot: string): string {
  return path.join(projectRoot, "runtime");
}

export function getRuntimeConfig(): WeatherRuntimeConfig {
  if (cachedConfig) return cachedConfig;

  const projectRoot = process.cwd();
  const workspaceDir =
    resolveFrom(projectRoot, process.env.WEATHER_WORKSPACE_DIR) ??
    defaultWorkspaceDir(projectRoot);
  const catalogPath =
    resolveFrom(projectRoot, process.env.WEATHER_CATALOG_PATH) ??
    path.join(workspaceDir, "notouch!", "catalog.json");
  const videosDir =
    resolveFrom(projectRoot, process.env.WEATHER_VIDEOS_DIR) ??
    path.join(workspaceDir, "videos");
  const musicDir =
    resolveFrom(projectRoot, process.env.WEATHER_MUSIC_DIR) ??
    path.join(workspaceDir, "music");
  const runtimeDir =
    resolveFrom(projectRoot, process.env.WEATHER_RUNTIME_DIR) ??
    defaultRuntimeDir(projectRoot);
  const userDataDir = resolveFrom(projectRoot, process.env.WEATHER_USER_DATA_DIR) ?? null;

  cachedConfig = {
    projectRoot,
    desktopMode: process.env.DESKTOP_MODE === "1",
    desktopSessionToken: normalizeOptional(process.env.DESKTOP_SESSION_TOKEN) ?? null,
    workspaceDir,
    catalogPath,
    videosDir,
    musicDir,
    runtimeDir,
    userDataDir,
    ffmpegPath: normalizeOptional(process.env.FFMPEG_PATH),
    ffprobePath: normalizeOptional(process.env.FFPROBE_PATH),
    bgMusicPath:
      resolveFrom(projectRoot, process.env.BG_MUSIC_PATH) ??
      path.join(musicDir, "מוזיקת אנדר לתחזית.mp3"),
  };

  return cachedConfig;
}

export function resetRuntimeConfigForTests(): void {
  cachedConfig = null;
}
