import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const forgeConfig = require("../../forge.config.cjs") as {
  packagerConfig?: { asar?: { unpack?: string } };
};

describe("forge packaging config", () => {
  it("unpacks standalone Next metadata needed by packaged server.js", () => {
    const unpack = forgeConfig.packagerConfig?.asar?.unpack ?? "";

    expect(unpack).toContain("**/.next/standalone/**");
    expect(unpack).toContain("**/.next/standalone/.next/**");
  });

  it("unpacks ffmpeg/ffprobe binaries so spawn() can exec them outside the asar", () => {
    const unpack = forgeConfig.packagerConfig?.asar?.unpack ?? "";

    expect(unpack).toContain("**/node_modules/ffmpeg-static/**");
    expect(unpack).toContain("**/node_modules/ffprobe-static/**");
  });
});
