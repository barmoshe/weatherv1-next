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
//   - macOS signing + notarization are driven entirely by env vars so a
//     local make on a developer Mac can flip them on while CI (Windows
//     only today) never accidentally tries to notarize.
//   - Windows installers are unsigned by design. Users see a one-time
//     SmartScreen "unknown publisher" warning on first install.

"use strict";

const path = require("node:path");

const APPLE_ID = process.env.APPLE_ID;
const APPLE_APP_SPECIFIC_PASSWORD = process.env.APPLE_APP_SPECIFIC_PASSWORD;
const APPLE_TEAM_ID = process.env.APPLE_TEAM_ID;
const OSX_SIGN_IDENTITY = process.env.OSX_SIGN_IDENTITY;

const haveMacSigning = Boolean(
  APPLE_ID &&
    APPLE_APP_SPECIFIC_PASSWORD &&
    APPLE_TEAM_ID &&
    (process.env.MAC_CERTIFICATE_IMPORTED === "1" || !process.env.GITHUB_ACTIONS)
);

// Escape a literal package/scope name for use inside a RegExp.
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// `ffprobe-static` ships EVERY OS's binaries under bin/{darwin,linux,win32}
// (~335MB total); only the host platform's can ever execute, so strip the
// foreign ones. Windows is built on a Windows runner and macOS locally on a
// Mac, so process.platform === target — this does NOT support cross-building
// for another OS. (`ffmpeg-static` installs a single per-platform binary, so
// it needs no stripping.)
const FFPROBE_FOREIGN_OS =
  { darwin: ["win32", "linux"], win32: ["darwin", "linux"], linux: ["darwin", "win32"] }[
    process.platform
  ] || [];

// Server-only npm packages the Next standalone server bundles (or carries in
// its OWN `.next/standalone/node_modules`) and that the Electron MAIN process
// never require()s. Forge packs the project-root node_modules into app.asar by
// default, so these root copies are pure dead weight. The main process needs
// only electron-squirrel-startup, update-electron-app, ffmpeg-static,
// ffprobe-static (see electron/main.cjs + electron/ffmpeg-verify.cjs).
// IMPORTANT: these regexes are root-anchored (`^/node_modules/…`) so they do
// NOT match `/.next/standalone/node_modules/…` — the server's tree is untouched.
// Native-binding packages (@img/sharp, argon2) are intentionally NOT listed.
// After editing this list, verify with a packaged render smoke-test.
const ROOT_DEAD_WEIGHT = [
  "next",
  "@next",
  "react",
  "react-dom",
  "scheduler",
  "openai",
  "@anthropic-ai",
  "@tanstack",
  "zod",
  "zod-to-json-schema",
  "lodash",
  "caniuse-lite",
  "@pulumi",
  "@electron-forge",
];

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
    // Bundled assets that ship inside the app at `Contents/Resources/<name>`
    // (macOS) / `resources/<name>` (Windows/Linux). The Next child server
    // resolves these via `WEATHER_RESOURCES_DIR` (set in
    // `electron/config.cjs:buildChildEnv`). Kept outside asar so files
    // (e.g. ffmpeg-friendly mp3) don't need unpack rules.
    extraResource: [path.join(__dirname, "assets", "bg-music")],
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
        "{**/node_modules/ffmpeg-static/**,**/node_modules/ffprobe-static/**,**/node_modules/@ffmpeg-installer/**,**/node_modules/@ffprobe-installer/**,**/.next/standalone/**,**/.next/standalone/.next/**}",
    },
    // Ship the standalone Next tree + scripts that Electron main + the spawn
    // child actually need. Forge defaults to packaging the entire project
    // root; we trim aggressively to keep the .app size sane.
    ignore: [
      /^\/\.git(\/|$)/,
      /^\/\.github(\/|$)/,
      // Generated files under electron/ must never ship: a stale
      // r2-defaults.generated.cjs from a pre-v0.6.0 build holds a plaintext
      // credential, is gitignored (invisible), and nothing reads it anymore.
      /^\/electron\/.*\.generated\.cjs$/,
      // Forge's own output dir — never pack prior packaged apps / make zips
      // back into the app (a multi-GB make zip blows asar's 2 GiB file limit).
      /^\/out(\/|$)/,
      /^\/\.next\/cache(\/|$)/,
      /^\/docs(\/|$)/,
      /^\/runtime(\/|$)/,
      // Dev runtime data that Next's whole-project file-trace sweeps into the
      // standalone tree (~770MB of jobs/outputs/cache). The packaged app reads
      // its runtime from userData (WEATHER_RUNTIME_DIR), never this copy, so it
      // is pure dead weight. Targeted at the data dir only — NOT the code dirs
      // `.next/standalone/src/server/runtime` etc. (outputFileTracingExcludes
      // is the intended fix but the Turbopack build ignores it.)
      /^\/\.next\/standalone\/runtime(\/|$)/,
      /^\/src\/test(\/|$)/,
      /^\/coverage(\/|$)/,
      /\.test\.[jt]sx?$/,
      // Root-only server deps the main process never loads (the standalone tree
      // keeps its own). Root-anchored so the standalone copies survive.
      ...ROOT_DEAD_WEIGHT.map((p) => new RegExp(`^/node_modules/${esc(p)}(/|$)`)),
      // Foreign-OS ffprobe binaries that can't run on the target platform.
      ...FFPROBE_FOREIGN_OS.map(
        (os) => new RegExp(`^/node_modules/ffprobe-static/bin/${esc(os)}(/|$)`),
      ),
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
  // Skip the @electron/rebuild pass entirely: the only native dep (argon2)
  // is N-API with bundled prebuilds for every target we ship, so rebuilding
  // is redundant — and it drags a Visual Studio requirement into the Windows
  // CI runner, whose node-gyp VS finder crashes on current runner images
  // (ERR_CHILD_PROCESS_STDIO_MAXBUFFER; broke the v0.5.x tag builds).
  rebuildConfig: { onlyModules: [] },
  makers: [
    {
      // macOS: ZIP. The plan picks ZIP over DMG because `update-electron-app`
      // / Squirrel.Mac update feeds expect ZIP artifacts.
      name: "@electron-forge/maker-zip",
      platforms: ["darwin"],
    },
    {
      // Windows: Squirrel. `update-electron-app` needs Squirrel.Windows
      // semantics on the feed side. Installers ship unsigned today.
      name: "@electron-forge/maker-squirrel",
      config: {
        name: "weatherv1",
        setupExe: "WeatherV1-Setup.exe",
        setupIcon: path.join(__dirname, "build", "icon.ico"),
        // Branded animation shown in the Squirrel installer window during
        // file copy. 640x480 (Squirrel's native loadingGif dimensions),
        // ~4s loop. Source HTML + render script live in the parent
        // claude-creative-stack repo at
        // `artifacts/html/weatherv1-installer-loading.html` and
        // `scripts/render-weatherv1-installer-gif.mjs`.
        loadingGif: path.join(__dirname, "build", "installer-loading.gif"),
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
