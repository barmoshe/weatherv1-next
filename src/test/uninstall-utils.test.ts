import { describe, expect, it } from "vitest";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { buildWindowsCleanupCmd } = require("../../electron/uninstall-utils.cjs") as {
  buildWindowsCleanupCmd: (userDataPath: string, updateExePath: string) => string;
};

describe("buildWindowsCleanupCmd", () => {
  it("chains timeout, rmdir, and Update.exe --uninstall in order", () => {
    const cmd = buildWindowsCleanupCmd(
      "C:\\Users\\bar\\AppData\\Roaming\\WeatherV1",
      "C:\\Users\\bar\\AppData\\Local\\weatherv1\\Update.exe",
    );
    const timeoutAt = cmd.indexOf("timeout /t 3");
    const rmdirAt = cmd.indexOf("rmdir /s /q");
    const uninstallAt = cmd.indexOf("--uninstall");
    expect(timeoutAt).toBeGreaterThanOrEqual(0);
    expect(rmdirAt).toBeGreaterThan(timeoutAt);
    expect(uninstallAt).toBeGreaterThan(rmdirAt);
  });

  it("waits silently (>nul) so no console window flashes", () => {
    const cmd = buildWindowsCleanupCmd("C:\\u", "C:\\Update.exe");
    expect(cmd).toContain("/nobreak >nul");
  });

  it("double-quotes both paths so spaces survive cmd.exe parsing", () => {
    const cmd = buildWindowsCleanupCmd(
      "C:\\Users\\bar moshe\\AppData\\Roaming\\WeatherV1",
      "C:\\Program Files\\weatherv1\\Update.exe",
    );
    expect(cmd).toContain('"C:\\Users\\bar moshe\\AppData\\Roaming\\WeatherV1"');
    expect(cmd).toContain('"C:\\Program Files\\weatherv1\\Update.exe"');
  });

  it("rejects empty or non-string inputs to fail loud instead of crafting a half-broken cmd", () => {
    expect(() => buildWindowsCleanupCmd("", "C:\\Update.exe")).toThrow();
    expect(() => buildWindowsCleanupCmd("C:\\u", "")).toThrow();
    // @ts-expect-error intentional bad input
    expect(() => buildWindowsCleanupCmd(undefined, "C:\\Update.exe")).toThrow();
    // @ts-expect-error intentional bad input
    expect(() => buildWindowsCleanupCmd("C:\\u", null)).toThrow();
  });
});
