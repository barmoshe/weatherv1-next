// Pure helpers for the "uninstall + cleanup" desktop flow.
//
// Extracted so they can be exercised from vitest without spinning up Electron.
// Anything that touches `dialog`, `spawn`, `app.quit`, or the filesystem
// stays in `electron/main.cjs`.

"use strict";

/**
 * Build the composite Windows command line that:
 *   1. waits ~3s for the parent app to exit (releases userData file locks),
 *   2. deletes the userData folder,
 *   3. runs the Squirrel uninstaller.
 *
 * The result is meant to be passed verbatim to:
 *   spawn("cmd.exe", ["/c", cmdLine], { windowsVerbatimArguments: true, ... })
 *
 * Both paths are quoted with double-quotes — that's what cmd.exe expects for
 * paths containing spaces (e.g. "C:\Users\bar moshe\AppData\Roaming\WeatherV1").
 */
function buildWindowsCleanupCmd(userDataPath, updateExePath) {
  if (typeof userDataPath !== "string" || !userDataPath) {
    throw new Error("buildWindowsCleanupCmd: userDataPath must be a non-empty string");
  }
  if (typeof updateExePath !== "string" || !updateExePath) {
    throw new Error("buildWindowsCleanupCmd: updateExePath must be a non-empty string");
  }
  return (
    `timeout /t 3 /nobreak >nul & ` +
    `rmdir /s /q "${userDataPath}" & ` +
    `"${updateExePath}" --uninstall`
  );
}

module.exports = { buildWindowsCleanupCmd };
