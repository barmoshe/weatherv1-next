import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { POST as clearDerivedCachePost } from "@/app/api/runtime/clear-derived-cache/route";
import { DESKTOP_AUTH_HEADER, assertDesktopAuth } from "@/server/runtime/auth";
import { clearDerivedRuntimeCaches } from "@/server/runtime/clear-derived-cache";
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
  "EDITOR_PASSWORD",
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
    expect(paths.renderTmpDir).toBe(path.join(runtime, "tmp", "renders"));
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

describe("clearDerivedRuntimeCaches", () => {
  it("clears posters, previews, segment posters, render tmp, and tagging; preserves uploads", async () => {
    const workspace = makeTempDir("clear-cache-workspace");
    const runtime = makeTempDir("clear-cache-runtime");
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    process.env.WEATHER_RUNTIME_DIR = runtime;
    resetRuntimeState();

    const paths = getRuntimePaths();
    fs.mkdirSync(paths.postersDir, { recursive: true });
    fs.writeFileSync(path.join(paths.postersDir, "x.jpg"), "x");
    fs.mkdirSync(paths.previewsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.previewsDir, "p.mp4"), "p");
    fs.mkdirSync(paths.segmentPostersDir, { recursive: true });
    fs.writeFileSync(path.join(paths.segmentPostersDir, "s.jpg"), "s");
    fs.mkdirSync(paths.renderTmpDir, { recursive: true });
    fs.writeFileSync(path.join(paths.renderTmpDir, "tmp.bin"), "t");
    const taggingDir = path.join(paths.cacheDir, "tagging");
    fs.mkdirSync(taggingDir, { recursive: true });
    fs.writeFileSync(path.join(taggingDir, "q.json"), "{}");

    fs.mkdirSync(paths.uploadsDir, { recursive: true });
    fs.writeFileSync(path.join(paths.uploadsDir, "keep.bin"), "k");

    await clearDerivedRuntimeCaches();

    expect(fs.readdirSync(paths.postersDir)).toEqual([]);
    expect(fs.readdirSync(paths.previewsDir)).toEqual([]);
    expect(fs.readdirSync(paths.segmentPostersDir)).toEqual([]);
    expect(fs.readdirSync(paths.renderTmpDir)).toEqual([]);
    expect(fs.readdirSync(taggingDir)).toEqual([]);
    expect(fs.readFileSync(path.join(paths.uploadsDir, "keep.bin"), "utf8")).toBe("k");
  });

  it("POST /api/runtime/clear-derived-cache requires desktop auth when desktop mode is on", async () => {
    const workspace = makeTempDir("clear-cache-api-workspace");
    const runtime = makeTempDir("clear-cache-api-runtime");
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "secret";
    process.env.WEATHER_WORKSPACE_DIR = workspace;
    process.env.WEATHER_RUNTIME_DIR = runtime;
    resetRuntimeState();

    const paths = getRuntimePaths();
    fs.mkdirSync(paths.postersDir, { recursive: true });
    fs.writeFileSync(path.join(paths.postersDir, "a.jpg"), "a");

    const denied = await clearDerivedCachePost(
      new NextRequest("http://localhost/api/runtime/clear-derived-cache", { method: "POST" }),
    );
    expect(denied.status).toBe(401);

    const ok = await clearDerivedCachePost(
      new NextRequest("http://localhost/api/runtime/clear-derived-cache", {
        method: "POST",
        headers: new Headers({ [DESKTOP_AUTH_HEADER]: "secret" }),
      }),
    );
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { success: boolean; cleared_paths?: string[] };
    expect(body.success).toBe(true);
    expect(Array.isArray(body.cleared_paths)).toBe(true);
    expect(fs.readdirSync(paths.postersDir)).toEqual([]);
  });
});

describe("electron config R2 settings", () => {
  it("uses in-repo runtime/workspace and Cloudflare R2 defaults when unpackaged", () => {
    const userData = makeTempDir("electron-config-dev-defaults");
    electronConfig.setUserDataDir(userData);

    const env = electronConfig.buildChildEnv({
      port: 3765,
      token: "desktop-token",
      ffmpeg: { ffmpegPath: null, ffprobePath: null },
      productionMode: false,
    });

    expect(env.WEATHER_WORKSPACE_DIR).toBe(
      path.join(path.resolve(__dirname, "../.."), "runtime", "workspace"),
    );
    expect(env.R2_SYNC_ENABLED).toBeUndefined();
  });

  it("injects production gateway/tenant/bucket in dev when R2 is enabled in settings", () => {
    const userData = makeTempDir("electron-config-dev-r2");
    electronConfig.setUserDataDir(userData);

    electronConfig.writeSettings({
      r2: { enabled: true, appUsername: "v1editor" },
      keys: {
        r2AppPassword: electronConfig.encryptSecret("pw", {}),
      },
    });

    const env = electronConfig.buildChildEnv({
      port: 3765,
      token: "desktop-token",
      ffmpeg: { ffmpegPath: null, ffprobePath: null },
      productionMode: false,
    });

    expect(env.R2_SYNC_ENABLED).toBe("1");
    expect(env.R2_GATEWAY_URL).toBe(electronConfig.PRODUCTION_R2.gatewayUrl);
    expect(env.R2_TENANT_ID).toBe("default");
    expect(env.R2_BUCKET_NAME).toBe("weatherv1-media");
    expect(env.R2_APP_USERNAME).toBe("v1editor");
    expect(env.EDITOR_PASSWORD).toBe("pw");
  });

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
    expect(env.EDITOR_PASSWORD).toBe("super-secret-pw");
    expect(env.R2_BUCKET_NAME).toBe("weatherv1-media");
    expect(env.R2_STATE_PATH).toBe(path.join(userData, "r2-sync-state.json"));
    // Sanity: legacy single-token env must not be set.
    expect(env.R2_SESSION_TOKEN).toBeUndefined();
  });

  it("sets WEATHER_RUNTIME_DIR under userData when packaged (productionMode)", () => {
    const userData = makeTempDir("electron-config-prod-runtime");
    electronConfig.setUserDataDir(userData);

    const env = electronConfig.buildChildEnv({
      port: 3765,
      token: "desktop-token",
      ffmpeg: { ffmpegPath: null, ffprobePath: null },
      productionMode: true,
    });

    const expected = path.join(userData, "server-runtime");
    expect(env.WEATHER_RUNTIME_DIR).toBe(expected);
    expect(fs.existsSync(expected)).toBe(true);
  });

  it("does not set WEATHER_RUNTIME_DIR when unpackaged (productionMode false)", () => {
    const userData = makeTempDir("electron-config-dev-runtime");
    electronConfig.setUserDataDir(userData);

    const env = electronConfig.buildChildEnv({
      port: 3765,
      token: "desktop-token",
      ffmpeg: { ffmpegPath: null, ffprobePath: null },
      productionMode: false,
    });

    expect(env.WEATHER_RUNTIME_DIR).toBeUndefined();
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
