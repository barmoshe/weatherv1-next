import fs from "node:fs";
import path from "node:path";
import { getRuntimeConfig } from "@/server/runtime/config";

const BG_MUSIC_FILENAME = "מוזיקת אנדר לתחזית.mp3";

/**
 * Resolve the canonical bundled bg-music file shipped with the app.
 *
 * - Packaged Electron app: Electron main copies `assets/bg-music/` to
 *   `Contents/Resources/bg-music/` via Forge `extraResource` and forwards
 *   `process.resourcesPath` to the Next child as `WEATHER_RESOURCES_DIR`.
 * - Dev / server runs: the file lives in the repo at `assets/bg-music/`.
 *
 * Both call sites return the same filename so renders are byte-identical
 * regardless of how the app is launched.
 */
function getBundledBgMusicPath(): string {
  const resourcesDir = process.env.WEATHER_RESOURCES_DIR;
  if (resourcesDir) {
    return path.join(resourcesDir, "bg-music", BG_MUSIC_FILENAME);
  }
  return path.join(getRuntimeConfig().projectRoot, "assets", "bg-music", BG_MUSIC_FILENAME);
}

export interface WorkspaceValidation {
  workspaceDir: string;
  catalogPath: string;
  videosDir: string;
  musicDir: string;
  missing: string[];
  ready: boolean;
}

export interface AssetSource {
  kind: "local-workspace";
  getWorkspaceDir(): string;
  getCatalogPath(): string;
  getVideosDir(): string;
  getMusicDir(): string;
  getDefaultBgMusicPath(): string;
  ensureWorkspaceScaffold(): void;
  validateWorkspace(): WorkspaceValidation;
  resolveVideoPath(filename: string): string;
}

export class LocalWorkspaceAssetSource implements AssetSource {
  readonly kind = "local-workspace";

  getWorkspaceDir(): string {
    return getRuntimeConfig().workspaceDir;
  }

  getCatalogPath(): string {
    return getRuntimeConfig().catalogPath;
  }

  getVideosDir(): string {
    return getRuntimeConfig().videosDir;
  }

  getMusicDir(): string {
    return getRuntimeConfig().musicDir;
  }

  getDefaultBgMusicPath(): string {
    const configured = getRuntimeConfig().bgMusicPath;
    if (fs.existsSync(configured)) return configured;
    return getBundledBgMusicPath();
  }

  ensureWorkspaceScaffold(): void {
    const catalogPath = this.getCatalogPath();
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true });
    fs.mkdirSync(this.getVideosDir(), { recursive: true });
    fs.mkdirSync(this.getMusicDir(), { recursive: true });

    if (!fs.existsSync(catalogPath)) {
      fs.writeFileSync(
        catalogPath,
        JSON.stringify({ videos: [], updated_at: new Date().toISOString() }, null, 2),
        "utf8",
      );
    }
  }

  validateWorkspace(): WorkspaceValidation {
    const catalogPath = this.getCatalogPath();
    const videosDir = this.getVideosDir();
    const musicDir = this.getMusicDir();
    const missing = [
      !fs.existsSync(catalogPath) ? "catalog" : null,
      !fs.existsSync(videosDir) ? "videos" : null,
      !fs.existsSync(musicDir) ? "music" : null,
    ].filter(Boolean) as string[];

    return {
      workspaceDir: this.getWorkspaceDir(),
      catalogPath,
      videosDir,
      musicDir,
      missing,
      ready: missing.length === 0,
    };
  }

  resolveVideoPath(filename: string): string {
    return path.join(this.getVideosDir(), filename);
  }
}

let cachedAssetSource: AssetSource | null = null;

export function getAssetSource(): AssetSource {
  if (!cachedAssetSource) {
    cachedAssetSource = new LocalWorkspaceAssetSource();
  }
  return cachedAssetSource;
}

export function resetAssetSourceForTests(): void {
  cachedAssetSource = null;
}
