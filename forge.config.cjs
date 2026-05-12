// Electron Forge configuration.
//
// Forge orchestrates: packaging → asar + asarUnpack → code signing →
// notarization → makers (ZIP/Squirrel) → publisher (GitHub).
//
// Wired specifically for the desktop plan's constraints:
//   - ffmpeg + ffprobe ship as bundled binaries that MUST be unpacked from
//     app.asar — executables packed in asar cannot be exec'd. The path
//     rewrite `app.asar → app.asar.unpacked` happens at call time in
//     `electron/ffmpeg-verify.cjs`; the unpacked files need to actually exist
//     at that location, which is what `asarUnpack` makes true at package time.
//   - `@electron-forge/plugin-auto-unpack-natives` handles `*.node` native
//     modules. ffmpeg/ffprobe aren't `.node` files, so they need explicit
//     `asarUnpack` entries on top of the plugin.
//   - macOS hardened runtime with `com.apple.security.cs.allow-jit`.
//     NOT `allow-unsigned-executable-memory` (Electron 12+ doesn't need it).
//   - Signing + notarization are driven entirely by env vars so release CI
//     can flip them on with secrets while local dev never accidentally tries
//     to notarize (which would block on missing Apple credentials).
//
// Required release-CI secrets (macOS): MAC_CERTIFICATE_BASE64,
//   MAC_CERTIFICATE_PASSWORD, KEYCHAIN_PASSWORD, APPLE_ID,
//   APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, OSX_SIGN_IDENTITY (optional if
//   the imported keychain has a single Developer ID Application identity).
// Required release-CI secrets (Windows): WIN_CERTIFICATE_BASE64,
//   WIN_CERT_PASSWORD. The workflow decodes this to WIN_CERT_FILE for Forge.

"use strict";

const path = require("node:path");

const APPLE_ID = process.env.APPLE_ID;
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const OSX_SIGN_IDENTITY = process.env.OSX_SIGN_IDENTITY;
const WIN_CERT_FILE = process.env.WIN_CERT_FILE;
const WIN_CERT_PASSWORD = process.env.WIN_CERT_PASSWORD;

const haveMacSigning = Boolean(
  APPLE_ID &&
    APPLE_APP_SPECIFIC_PASSWORD &&
    APPLE_TEAM_ID &&
    (process.env.MAC_CERTIFICATE_IMPORTED === "1" || !process.env.GITHUB_ACTIONS)
);
const haveWinSigning = Boolean(WIN_CERT_FILE && WIN_CERT_PASSWORD);

/** @type {import('@electron-forge/shared-types').ForgeConfig} */
module.exports = {
  packagerConfig: {
    name: "WeatherV1",
    executableName: "weatherv1",
    appBundleId: "com.weatherv1.desktop",
    appCategoryType: "public.app-category.video",
    // Forge appends the platform-correct extension (.icns on macOS, .ico on
    // Windows) — supply the path without extension.
    icon: path.join(__dirname, "build", "icon"),
    asar: {
      // Executables under these paths MUST live in `app.asar.unpacked`.
      // `ffmpeg-verify.cjs` rewrites `app.asar → app.asar.unpacked` at call
      // time, but the rewritten file only exists if it's been unpacked here.
      // Patterns are glob, matched against paths inside the asar archive.
      // The explicit `.next/standalone/.next/**` entry is intentional: some
      // asar glob matching skips dot-directories inside the standalone tree,
      // which leaves `BUILD_ID` packed in app.asar while `server.js` runs from
      // app.asar.unpacked and then fails with "Could not find a production
      // build in './.next'".
      unpack:
        "{**/node_modules/ffmpeg-static/**,**/node_modules/ffprobe-static/**,**/node_modules/@ffmpeg-installer/**,**/node_modules/@ffprobe-installer/**,**/.next/standalone/**,**/.next/standalone/.next/**,**/node_modules/onnxruntime-node/**,**/node_modules/@huggingface/transformers/**,**/node_modules/wavefile/**}",
    },
    // Ship the standalone Next tree + scripts that Electron main + the spawn
    // child actually need. Forge defaults to packaging the entire project
    // root; we trim aggressively to keep the .app size sane.
    ignore: [
      /^\/\.git(\/|$)/,
      /^\/\.github(\/|$)/,
      /^\/\.next\/cache(\/|$)/,
      /^\/docs(\/|$)/,
      /^\/runtime(\/|$)/,
      /^\/src\/test(\/|$)/,
      /^\/coverage(\/|$)/,
      /\.test\.[jt]sx?$/,
    ],
    osxSign: haveMacSigning
      ? {
          identity: OSX_SIGN_IDENTITY, // optional — falls back to Developer ID in keychain
          optionsForFile: () => ({
            // Hardened runtime is required for notarization.
            hardenedRuntime: true,
            entitlements: path.join(__dirname, "build", "entitlements.mac.plist"),
            "entitlements-inherit": path.join(__dirname, "build", "entitlements.mac.plist"),
            // Sign the inner ffmpeg binary too — it lives in
            // `Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg`
            // and Gatekeeper will SIGKILL it on first launch if it isn't
            // signed under the host's Developer ID.
            signatureFlags: "library",
          }),
        }
      : undefined,
    osxNotarize: haveMacSigning
      ? {
          tool: "notarytool",
          appleId: APPLE_ID,
          appleIdPassword: APPLE_APP_SPECIFIC_PASSWORD,
          teamId: APPLE_TEAM_ID,
        }
      : undefined,
  },
  rebuildConfig: {},
  makers: [
    {
      // macOS: ZIP. The plan picks ZIP over DMG because `update-electron-app`
      // / Squirrel.Mac update feeds expect ZIP artifacts.
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      // Windows: Squirrel. `update-electron-app` needs Squirrel.Windows
      // semantics on the feed side.
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "weatherv1",
        setupExe: "WeatherV1-Setup.exe",
        setupIcon: path.join(__dirname, "build", "icon.ico"),
        ...(haveWinSigning
          ? { certificateFile: WIN_CERT_FILE, certificatePassword: WIN_CERT_PASSWORD }
          : {}),
      },
    },
  ],
  plugins: [
    {
      name: "@electron-forge/plugin-auto-unpack-natives",
      config: {},
    },
  ],
  publishers: [
    // GitHub Releases publisher is the natural pair with `update-electron-app`
    // via `update.electronjs.org`. Configure when the release CI is wired.
    // {
    //   name: "@electron-forge/publisher-github",
    //   config: {
    //     repository: { owner: "barmoshe", name: "weatherv1-next" },
    //     prerelease: false,
    //     draft: true,
    //   },
    // },
  ],
  hooks: {
    // No custom hooks yet. The standalone copy step runs from npm scripts
    // (`standalone:prep`) before `electron:build` / `electron:make` so it
    // doesn't need to be a Forge hook.
  },
};
