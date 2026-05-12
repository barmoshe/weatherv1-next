import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESKTOP_AUTH_HEADER, assertDesktopAuth } from "@/server/runtime/auth";
import { getRuntimeConfig, resetRuntimeConfigForTests } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { getAssetSource, resetAssetSourceForTests } from "@/server/assets/source";

const ENV_KEYS = [
  "DESKTOP_MODE",
  "DESKTOP_SESSION_TOKEN",
  "WEATHER_WORKSPACE_DIR",
  "WEATHER_CATALOG_PATH",
  "WEATHER_VIDEOS_DIR",
  "WEATHER_MUSIC_DIR",
  "WEATHER_RUNTIME_DIR",
  "WEATHER_USER_DATA_DIR",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
  "BG_MUSIC_PATH",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDirs: string[] = [];

function resetRuntimeState() {
  resetRuntimeConfigForTests();
  resetAssetSourceForTests();
}

function makeTempDir(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `weatherv1-${name}-`));
  tempDirs.push(dir);
  return dir;
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetRuntimeState();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRuntimeState();
  for (const dir of tempDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe("desktop runtime config", () => {
  it("resolves the desktop env contract into runtime paths", () => {
    const workspace = makeTempDir("workspace");
    const runtime = makeTempDir("runtime");
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "secret";
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    process.env.WEATHER_RUNTIME_DIR = runtime;
    process.env.FFMPEG_PATH = "/usr/local/bin/ffmpeg";

    const config = getRuntimeConfig();
    const paths = getRuntimePaths();

    expect(config.desktopMode).toBe(true);
    expect(config.desktopSessionToken).toBe("secret");
    expect(config.workspaceDir).toBe(workspace);
    expect(config.catalogPath).toBe(path.join(workspace, "notouch!", "catalog.json"));
    expect(config.videosDir).toBe(path.join(workspace, "videos"));
    expect(config.musicDir).toBe(path.join(workspace, "music"));
    expect(config.ffmpegPath).toBe("/usr/local/bin/ffmpeg");
    expect(paths.uploadsDir).toBe(path.join(runtime, "uploads"));
    expect(paths.outputsDir).toBe(path.join(runtime, "outputs"));
    expect(paths.segmentPostersDir).toBe(path.join(runtime, "cache", "segment_posters"));
  });

  it("scaffolds and validates a local workspace", () => {
    const workspace = makeTempDir("asset-source");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    const source = getAssetSource();
    expect(source.validateWorkspace().ready).toBe(false);

    source.ensureWorkspaceScaffold();
    const validation = source.validateWorkspace();

    expect(validation).toMatchObject({
      workspaceDir: workspace,
      catalogPath: path.join(workspace, "notouch!", "catalog.json"),
      videosDir: path.join(workspace, "videos"),
      musicDir: path.join(workspace, "music"),
      missing: [],
      ready: true,
    });
    expect(JSON.parse(fs.readFileSync(validation.catalogPath, "utf8"))).toMatchObject({
      videos: [],
    });
  });
});

describe("desktop auth", () => {
  it("allows requests outside desktop mode", () => {
    const denied = assertDesktopAuth({ headers: new Headers() });
    expect(denied).toBeNull();
  });

  it("requires the desktop session token in desktop mode", () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "secret";
    resetRuntimeState();

    const denied = assertDesktopAuth({ headers: new Headers() });
    expect(denied?.status).toBe(401);

    const allowed = assertDesktopAuth({
      headers: new Headers({ [DESKTOP_AUTH_HEADER]: "secret" }),
    });
    expect(allowed).toBeNull();
  });
});
