// @vitest-environment node
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// NODE_ENV is handled separately via vi.stubEnv (typed as readonly in Node).
const ENV_KEYS = [
  "WEATHER_WORKSPACE_DIR",
  "WEATHER_RUNTIME_DIR",
  "WEATHER_CATALOG_PATH",
  "WEATHER_VIDEOS_DIR",
  "WEATHER_MUSIC_DIR",
  "WEATHER_USER_DATA_DIR",
  "DESKTOP_MODE",
  "DESKTOP_SESSION_TOKEN",
  "FFMPEG_PATH",
  "FFPROBE_PATH",
  "BG_MUSIC_PATH",
  "R2_SYNC_ENABLED",
  "R2_GATEWAY_URL",
  "R2_TENANT_ID",
  "R2_APP_USERNAME",
  "R2_APP_PASSWORD",
  "R2_ACCOUNT_ID",
  "R2_BUCKET_NAME",
  "R2_STATE_PATH",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

async function importConfig() {
  vi.resetModules();
  const mod = await import("@/server/runtime/config");
  mod.resetRuntimeConfigForTests();
  return mod;
}

beforeEach(() => {
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
  // Force a deterministic NODE_ENV; defaultWorkspaceDir branches on it.
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("getRuntimeConfig defaults (development)", () => {
  it("workspaceDir defaults to <projectRoot>/runtime/workspace", async () => {
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.workspaceDir).toBe(path.join(cfg.projectRoot, "runtime", "workspace"));
  });

  it("runtimeDir defaults to <projectRoot>/runtime", async () => {
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.runtimeDir).toBe(path.join(cfg.projectRoot, "runtime"));
  });

  it("catalog/videos/music paths nest under workspaceDir", async () => {
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.catalogPath).toBe(path.join(cfg.workspaceDir, "notouch!", "catalog.json"));
    expect(cfg.videosDir).toBe(path.join(cfg.workspaceDir, "videos"));
    expect(cfg.musicDir).toBe(path.join(cfg.workspaceDir, "music"));
  });

  it("desktopMode is false and desktopSessionToken is null when unset", async () => {
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.desktopMode).toBe(false);
    expect(cfg.desktopSessionToken).toBeNull();
  });

  it("userDataDir defaults to null", async () => {
    const { getRuntimeConfig } = await importConfig();
    expect(getRuntimeConfig().userDataDir).toBeNull();
  });

  it("r2.enabled is false when R2_SYNC_ENABLED is unset", async () => {
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.r2.enabled).toBe(false);
    expect(cfg.r2.gatewayUrl).toBeUndefined();
    expect(cfg.r2.tenantId).toBeUndefined();
  });

  it("ffmpegPath/ffprobePath are undefined when env vars are unset", async () => {
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.ffmpegPath).toBeUndefined();
    expect(cfg.ffprobePath).toBeUndefined();
  });
});

describe("getRuntimeConfig overrides", () => {
  it("WEATHER_WORKSPACE_DIR propagates to catalogPath/videosDir/musicDir", async () => {
    process.env.WEATHER_WORKSPACE_DIR = "/abs/space";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.workspaceDir).toBe("/abs/space");
    expect(cfg.catalogPath).toBe(path.join("/abs/space", "notouch!", "catalog.json"));
    expect(cfg.videosDir).toBe(path.join("/abs/space", "videos"));
    expect(cfg.musicDir).toBe(path.join("/abs/space", "music"));
  });

  it("WEATHER_CATALOG_PATH overrides catalogPath without affecting videosDir", async () => {
    process.env.WEATHER_WORKSPACE_DIR = "/abs/space";
    process.env.WEATHER_CATALOG_PATH = "/custom/catalog.json";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.catalogPath).toBe("/custom/catalog.json");
    expect(cfg.videosDir).toBe(path.join("/abs/space", "videos"));
  });

  it("relative WEATHER_WORKSPACE_DIR is resolved against projectRoot", async () => {
    process.env.WEATHER_WORKSPACE_DIR = "relative/path";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.workspaceDir).toBe(path.resolve(cfg.projectRoot, "relative/path"));
  });

  it("blank env values are treated as unset", async () => {
    process.env.WEATHER_WORKSPACE_DIR = "   ";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.workspaceDir).toBe(path.join(cfg.projectRoot, "runtime", "workspace"));
  });

  it("DESKTOP_MODE=1 + DESKTOP_SESSION_TOKEN populates desktop fields", async () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "tok-1";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.desktopMode).toBe(true);
    expect(cfg.desktopSessionToken).toBe("tok-1");
  });

  it("R2_SYNC_ENABLED=1 with all fields populates r2 block", async () => {
    process.env.R2_SYNC_ENABLED = "1";
    process.env.R2_GATEWAY_URL = "https://gw/";
    process.env.R2_TENANT_ID = "t-1";
    process.env.R2_APP_USERNAME = "u";
    process.env.R2_APP_PASSWORD = "p";
    process.env.R2_BUCKET_NAME = "b";
    const { getRuntimeConfig } = await importConfig();
    expect(getRuntimeConfig().r2).toMatchObject({
      enabled: true,
      gatewayUrl: "https://gw/",
      tenantId: "t-1",
      appUsername: "u",
      appPassword: "p",
      bucketName: "b",
    });
  });

  it("R2_STATE_PATH override is resolved against projectRoot when relative", async () => {
    process.env.R2_STATE_PATH = "state/r2.json";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.r2.statePath).toBe(path.resolve(cfg.projectRoot, "state/r2.json"));
  });

  it("FFMPEG_PATH and FFPROBE_PATH pass through verbatim", async () => {
    process.env.FFMPEG_PATH = "/usr/bin/ffmpeg";
    process.env.FFPROBE_PATH = "/usr/bin/ffprobe";
    const { getRuntimeConfig } = await importConfig();
    const cfg = getRuntimeConfig();
    expect(cfg.ffmpegPath).toBe("/usr/bin/ffmpeg");
    expect(cfg.ffprobePath).toBe("/usr/bin/ffprobe");
  });
});

describe("caching", () => {
  it("getRuntimeConfig() returns the same instance on repeated calls", async () => {
    const { getRuntimeConfig } = await importConfig();
    const a = getRuntimeConfig();
    const b = getRuntimeConfig();
    expect(a).toBe(b);
  });

  it("ignores env changes until resetRuntimeConfigForTests() is called", async () => {
    process.env.WEATHER_WORKSPACE_DIR = "/first";
    const mod = await importConfig();
    expect(mod.getRuntimeConfig().workspaceDir).toBe("/first");

    process.env.WEATHER_WORKSPACE_DIR = "/second";
    expect(mod.getRuntimeConfig().workspaceDir).toBe("/first");

    mod.resetRuntimeConfigForTests();
    expect(mod.getRuntimeConfig().workspaceDir).toBe("/second");
  });
});
