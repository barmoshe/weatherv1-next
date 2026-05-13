import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DESKTOP_AUTH_HEADER, assertDesktopAuth } from "@/server/runtime/auth";
import { getRuntimeConfig, resetRuntimeConfigForTests } from "@/server/runtime/config";
import { getRuntimePaths } from "@/server/runtime/paths";
import { getAssetSource, resetAssetSourceForTests } from "@/server/assets/source";
import { resetCatalogStoreForTests } from "@/server/catalog/stores";

const electronConfig = require("../../electron/config.cjs") as any;

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
  "WEATHER_RESOURCES_DIR",
  "R2_SYNC_ENABLED",
  "R2_GATEWAY_URL",
  "R2_TENANT_ID",
  "R2_APP_USERNAME",
  "R2_APP_PASSWORD",
  "R2_STATE_PATH",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;
let tempDirs: string[] = [];

function resetRuntimeState() {
  resetRuntimeConfigForTests();
  resetAssetSourceForTests();
  resetCatalogStoreForTests();
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

  it("falls back to the bundled bg-music file when the workspace copy is missing", () => {
    const workspace = makeTempDir("bg-music-workspace");
    const resources = makeTempDir("bg-music-resources");
    const bgFilename = "מוזיקת אנדר לתחזית.mp3";
    fs.mkdirSync(path.join(resources, "bg-music"), { recursive: true });
    fs.writeFileSync(path.join(resources, "bg-music", bgFilename), "bundled");

    process.env.WEATHER_WORKSPACE_DIR = workspace;
    process.env.WEATHER_RESOURCES_DIR = resources;
    resetRuntimeState();

    expect(getAssetSource().getDefaultBgMusicPath()).toBe(
      path.join(resources, "bg-music", bgFilename),
    );
  });

  it("prefers the workspace bg-music file when present", () => {
    const workspace = makeTempDir("bg-music-workspace-present");
    const bgFilename = "מוזיקת אנדר לתחזית.mp3";
    fs.mkdirSync(path.join(workspace, "music"), { recursive: true });
    fs.writeFileSync(path.join(workspace, "music", bgFilename), "workspace");

    process.env.WEATHER_WORKSPACE_DIR = workspace;
    resetRuntimeState();

    expect(getAssetSource().getDefaultBgMusicPath()).toBe(
      path.join(workspace, "music", bgFilename),
    );
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

describe("electron config R2 settings", () => {
  it("persists R2 settings and injects username/password env without leaking the password to renderer settings", () => {
    const userData = makeTempDir("electron-config");
    electronConfig.setUserDataDir(userData);

    electronConfig.writeSettings({
      r2: {
        enabled: true,
        gatewayUrl: "https://r2.example.workers.dev",
        tenantId: "tenant-1",
        bucketName: "weatherv1-media",
        appUsername: "weatherv1",
      },
      keys: {
        r2AppPassword: electronConfig.encryptSecret("super-secret-pw", {}),
      },
    });

    const settings = electronConfig.readSettings();
    expect(settings.r2).toMatchObject({
      enabled: true,
      gatewayUrl: "https://r2.example.workers.dev",
      tenantId: "tenant-1",
      bucketName: "weatherv1-media",
      appUsername: "weatherv1",
    });

    const env = electronConfig.buildChildEnv({
      port: 3765,
      token: "desktop-token",
      ffmpeg: { ffmpegPath: null, ffprobePath: null },
    });

    expect(env.R2_SYNC_ENABLED).toBe("1");
    expect(env.R2_GATEWAY_URL).toBe("https://r2.example.workers.dev");
    expect(env.R2_TENANT_ID).toBe("tenant-1");
    expect(env.R2_APP_USERNAME).toBe("weatherv1");
    expect(env.R2_APP_PASSWORD).toBe("super-secret-pw");
    expect(env.R2_BUCKET_NAME).toBe("weatherv1-media");
    expect(env.R2_STATE_PATH).toBe(path.join(userData, "r2-sync-state.json"));
    // Sanity: legacy single-token env must not be set.
    expect(env.R2_SESSION_TOKEN).toBeUndefined();
  });

  it("drops a legacy r2SessionToken on read instead of exposing it", () => {
    const userData = makeTempDir("electron-config-legacy");
    electronConfig.setUserDataDir(userData);

    // Simulate an upgrade from a previous release that stored a single token.
    const fs = require("node:fs") as typeof import("node:fs");
    const path = require("node:path") as typeof import("node:path");
    fs.writeFileSync(
      path.join(userData, "settings.json"),
      JSON.stringify({
        r2: { enabled: true, gatewayUrl: "https://r2.example.workers.dev", tenantId: "t" },
        keys: { r2SessionToken: { scheme: "plaintext", data: "legacy" } },
      }),
      "utf8",
    );

    const settings = electronConfig.readSettings();
    expect(settings.keys).not.toHaveProperty("r2SessionToken");
    expect(settings.keys.r2AppPassword ?? null).toBeNull();
  });
});
