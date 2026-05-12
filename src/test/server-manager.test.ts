import path from "node:path";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const serverManager = require("../../electron/server-manager.cjs") as {
  __internal: {
    resolveDevNextBinary: (projectRoot: string) => string | null;
    resolveStandaloneServer: (projectRoot: string) => string;
    unpackAsarPath: (p: string) => string;
  };
};

describe("server-manager", () => {
  it("resolves the standalone server entrypoint at the pinned Next output path", () => {
    const projectRoot = path.join("tmp", "weatherv1-next");

    expect(serverManager.__internal.resolveStandaloneServer(projectRoot)).toBe(
      path.join(projectRoot, ".next", "standalone", "server.js"),
    );
  });

  it("resolves packaged standalone server from app.asar.unpacked", () => {
    const projectRoot = path.join("WeatherV1.app", "Contents", "Resources", "app.asar");

    expect(serverManager.__internal.resolveStandaloneServer(projectRoot)).toBe(
      path.join("WeatherV1.app", "Contents", "Resources", "app.asar.unpacked", ".next", "standalone", "server.js"),
    );
  });

  it("rewrites app.asar paths to app.asar.unpacked", () => {
    expect(serverManager.__internal.unpackAsarPath("/tmp/WeatherV1.app/Contents/Resources/app.asar")).toBe(
      "/tmp/WeatherV1.app/Contents/Resources/app.asar.unpacked",
    );
    expect(serverManager.__internal.unpackAsarPath("/tmp/WeatherV1.app/Contents/Resources/app.asar/.next")).toBe(
      "/tmp/WeatherV1.app/Contents/Resources/app.asar.unpacked/.next",
    );
  });

  it("returns null for the dev next binary when node_modules is absent", () => {
    const missingProject = path.join("tmp", "definitely-missing-weatherv1-next");

    expect(serverManager.__internal.resolveDevNextBinary(missingProject)).toBeNull();
  });
});
