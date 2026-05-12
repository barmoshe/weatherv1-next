// Sanity test for the Electron-main ffmpeg verifier. We can't directly
// exercise the bundled-package branch here (those packages aren't installed
// until Step 6), but we lock in:
//   - the public shape of `verifyFFmpeg()`,
//   - the `unpackAsarPath` rewrite,
//   - the explicit-env-path branch returns `source: "env"` when the path
//     exists on disk and a warning when it doesn't.

import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ffmpegVerify = require("../../electron/ffmpeg-verify.cjs") as {
  verifyFFmpeg: (opts?: { ffmpegPath?: string; ffprobePath?: string }) => {
    ok: boolean;
    ffmpegPath: string | null;
    ffprobePath: string | null;
    ffmpegSource: string | null;
    ffprobeSource: string | null;
    errors: string[];
    warnings: string[];
  };
  unpackAsarPath: (p: string) => string;
};

describe("ffmpeg-verify", () => {
  it("returns a structured result with known keys (never throws)", () => {
    const result = ffmpegVerify.verifyFFmpeg();
    expect(result).toMatchObject({
      ok: expect.any(Boolean),
      errors: expect.any(Array),
      warnings: expect.any(Array),
    });
    expect(Object.keys(result).sort()).toEqual(
      [
        "errors",
        "ffmpegPath",
        "ffmpegSource",
        "ffprobePath",
        "ffprobeSource",
        "ok",
        "warnings",
      ].sort(),
    );
  });

  it("rewrites app.asar -> app.asar.unpacked on POSIX paths", () => {
    expect(ffmpegVerify.unpackAsarPath("/foo/app.asar/ffmpeg-static/ffmpeg")).toBe(
      "/foo/app.asar.unpacked/ffmpeg-static/ffmpeg",
    );
  });

  it("rewrites app.asar -> app.asar.unpacked on Windows paths", () => {
    expect(
      ffmpegVerify.unpackAsarPath("C:\\Foo\\app.asar\\ffmpeg-static\\ffmpeg.exe"),
    ).toBe("C:\\Foo\\app.asar.unpacked\\ffmpeg-static\\ffmpeg.exe");
  });

  it("does not rewrite paths that don't contain app.asar", () => {
    expect(ffmpegVerify.unpackAsarPath("/usr/local/bin/ffmpeg")).toBe(
      "/usr/local/bin/ffmpeg",
    );
  });

  it("flags missing explicit env paths as a warning, not a crash", () => {
    const fake = "/definitely/not/a/real/path/ffmpeg-xyzzy";
    expect(existsSync(fake)).toBe(false);
    const result = ffmpegVerify.verifyFFmpeg({ ffmpegPath: fake, ffprobePath: fake });
    expect(result.ok).toBe(false);
    expect(result.ffmpegPath).toBe(fake);
    expect(result.ffmpegSource).toBe("env");
    expect(result.warnings.join("|")).toMatch(/env path does not exist/);
  });
});
