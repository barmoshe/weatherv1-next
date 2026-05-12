# Electron Desktop Handoff

This is the "what's running, what's left, where the landmines are" doc for whoever picks up the work next. The architecture / design contract lives in `ELECTRON_DESKTOP_PLAN.md`; this doc is the operational handoff.

## TL;DR

Steps 1–9 of the plan are implemented through code, tests, and CI config. The runtime/auth/asset boundary is done, every mutating route is gated, the Electron shell scaffold is in place, Forge packaging config is written, the renderer now uses the desktop bridge when available, and desktop CI has a macOS + Windows matrix. Tests + typecheck + `next build` all pass on the host, and `npm run electron:dev` boots the Electron shell with a healthy local Next child.

The remaining work is runtime smoke testing beyond boot: save settings, exercise native audio/video pickers deliberately, and produce unsigned/signed installer artifacts.

## Snapshot

- Project root: `/Users/barmoshe/claude-creative-stack/weatherv1-next` (child repo with its own `.git`)
- Stack: Next 16.2.6 (App Router, `proxy.ts` is the renamed middleware), React 19.2.4, Vitest 2.x
- Local toolchain on the host: Node 20.19 by default, Node 22 LTS available via `npx node@22`. `next build` works fine on Node 20; Electron 33 ships its own Node 22 anyway.
- Latest verified state: `tsc --noEmit` clean, `npm test` 49/49, `npm run build` emits `.next/standalone/server.js`, `npm run standalone:prep` populates the standalone tree, `npm run electron:dev` boots on `127.0.0.1:3765` and `/api/internal/health` returns 200.

## How to run things

```
npm install            # one-time: materializes the new electron / forge / ffmpeg deps
npx tsc --noEmit       # typecheck
npm test               # vitest, 49 tests across 7 files
npm run dev            # plain Next dev (no Electron)
node_modules/.bin/next build && node scripts/prepare-standalone.cjs  # produce the standalone tree
npm run electron:dev   # Electron + next dev (needs `npm install` to have run)
npm run electron:build # next build + standalone:prep + electron-forge package
npm run electron:make  # …+ electron-forge make (ZIP / Squirrel installers)
```

If `node_modules` is missing or stale, run `npm install` before `electron:*` scripts. The new requires in `electron/main.cjs` (`update-electron-app`, `electron-squirrel-startup`) are wrapped in try/catch so plain web/type/test workflows stay resilient.

## File map

Backend / runtime:

| Path | Role |
| --- | --- |
| `src/server/runtime/config.ts` | Single source of truth for env-driven paths (workspace, runtime, ffmpeg, bg music). Cached singleton + `resetRuntimeConfigForTests()`. |
| `src/server/runtime/paths.ts` | Derives uploads/outputs/cache/posters/previews/segment_posters from `runtimeDir`. |
| `src/server/runtime/auth.ts` | `DESKTOP_AUTH_HEADER`, `isDesktopMode()`, `isDesktopRequestAuthorized()`, `assertDesktopAuth(req)` (returns `NextResponse \| null`). `timingSafeEqual` for the comparison. |
| `src/server/assets/source.ts` | `LocalWorkspaceAssetSource` (provider interface ready for a future `GoogleDriveAssetSource`). Cached singleton + reset hook. |
| `src/proxy.ts` | Token guard. Matchers: `/api/:path*`, `/outputs/:path*`, `/videos/:path*`. No-ops outside desktop mode. |
| `src/app/api/internal/health/route.ts` | Boot probe for the Electron supervisor. Auth-gated; returns workspace + ffmpeg readiness. |
| `src/app/api/desktop/status/route.ts` | Auth-gated GET surfacing runtime/workspace/key state to the (future) settings UI. |
| `src/shared/desktop.ts` | `DesktopBridge` interface — the contract between preload and renderer. |
| `src/types/desktop.d.ts` | `Window.desktop` ambient declaration. |

Electron / packaging:

| Path | Role |
| --- | --- |
| `electron/main.cjs` | Lifecycle: ffmpeg verify → session token gen → env build → spawn → health poll → BrowserWindow pinned to `persist:weatherv1` → `webRequest.onBeforeSendHeaders` token injection → `desktop:*` IPC handlers → `update-electron-app` for packaged builds. `electron-squirrel-startup` short-circuit at the top. |
| `electron/preload.cjs` | `contextBridge.exposeInMainWorld("desktop", { ... })` matching `DesktopBridge`. |
| `electron/server-manager.cjs` | Port pick (3765 → 3766 → 3767 → 3768; never ephemeral), dev/prod spawn, `pollHealth(origin, token)`, `restart(env)`. Pure-Node; no electron import. |
| `electron/config.cjs` | userData-backed `settings.json`; `safeStorage` for API keys with documented plaintext fallback; env builder; session-token generator. Pure-Node API; electron objects passed in as args. |
| `electron/ffmpeg-verify.cjs` | env → bundled → PATH resolution; `app.asar` → `app.asar.unpacked` rewrite; structured `{ ok, ffmpegPath, ffprobePath, ffmpegSource, ffprobeSource, errors, warnings }`; never throws. |
| `forge.config.cjs` | Packager + `asarUnpack` for ffmpeg packages + `.next/standalone/**`; osxSign (with `signatureFlags: "library"` for nested binaries); osxNotarize from env; makers (ZIP + Squirrel); auto-unpack-natives plugin; commented GitHub publisher. |
| `build/entitlements.mac.plist` | Hardened-runtime entitlements. Includes `allow-jit`, `disable-library-validation`, `allow-dyld-environment-variables`. Explicitly NOT `allow-unsigned-executable-memory`. |
| `scripts/prepare-standalone.cjs` | Copies `public/` and `.next/static/` into `.next/standalone/` after `next build`. |
| `scripts/run-electron.cjs` | Dev launcher that removes inherited `ELECTRON_RUN_AS_NODE` before spawning Electron. Required in this Codex shell. |

Config / lockfile-adjacent:

| Path | Role |
| --- | --- |
| `next.config.ts` | `output: "standalone"` + `turbopack.root: __dirname` (mandatory — see Sharp Edges). Existing `/outputs` / `/videos` rewrites kept. |
| `vitest.config.ts` | Excludes `**/.next/**` (mandatory — see Sharp Edges). |
| `package.json` | `"main": "electron/main.cjs"`. Pins `electron@^33`, `@electron-forge/cli@^7` + 4 forge sub-packages, `ffmpeg-static@^5`, `ffprobe-static@^3`, `update-electron-app@^3`, `electron-squirrel-startup@^1`. New scripts: `standalone:prep`, `electron:dev`, `electron:build`, `electron:make`. |
| `instrumentation.ts` | Soft (warning-only, dev-only) ffmpeg check for `next dev` parity. Skipped when `DESKTOP_MODE=1`. **Not** the authoritative ffmpeg gate. |

Renderer / CI:

| Path | Role |
| --- | --- |
| `src/client/lib/desktop.ts` | SSR-safe access to `window.desktop`. |
| `src/client/components/studio/SettingsModal.tsx` | Desktop status/settings surface: workspace, ffmpeg, key presence, version, updater, workspace picker, ffmpeg paths, API key save, restart overlay. |
| `src/client/components/studio/UploadCard.tsx` | Uses native audio picker in Electron and multipart browser upload otherwise. |
| `src/client/components/catalog/CatalogPanel.tsx` | Uses native catalog-video picker in Electron and browser file input otherwise; invalidates catalog/tag queries after import. |
| `src/test/runtime-desktop.test.ts` | Runtime env, workspace scaffold, and desktop auth coverage. |
| `src/test/server-manager.test.ts` | Pure server-manager path resolution coverage. |
| `.github/workflows/desktop.yml` | macOS + Windows desktop packaging smoke workflow. |

## Sharp edges

1. **`turbopack.root` must be pinned.** The host repo (`claude-creative-stack`) has its own `package-lock.json` one level above this project. Without `turbopack: { root: __dirname }` in `next.config.ts`, Next infers the workspace root from that lockfile and emits `.next/standalone/claude-creative-stack/weatherv1-next/server.js` — breaking `electron/server-manager.cjs`'s standalone resolution. Don't remove the pin.
2. **Vitest must exclude `.next`.** `output: "standalone"` copies `src/test/**` into the standalone tree. Without `exclude: [..., "**/.next/**"]`, every test runs twice and `npm test` reports 86 tests instead of 43.
3. **`instrumentation.ts` is not the ffmpeg gate.** Under `node .next/standalone/server.js`, Next 16 silently skips `register()` (vercel/next.js#89377). The authoritative ffmpeg check lives in `electron/ffmpeg-verify.cjs` and runs in Electron main *before* the child spawns. Don't move it into the Next side.
4. **Proxy is a perimeter, not a guarantee.** Server Actions in Next 16 POST to the route file that declares them. A new Server Action introduced in a route without proxy coverage would bypass the perimeter. Every mutating handler must call `assertDesktopAuth(req)` itself.
5. **ffmpeg/ffprobe can't run from inside `app.asar`.** `forge.config.cjs` lists them in `asarUnpack`; `electron/ffmpeg-verify.cjs` rewrites paths at call time. The unpacked binaries must be re-signed under the host's Developer ID on macOS — the `signatureFlags: "library"` setting in `osxSign` handles that.
6. **Auto-update needs signing on both platforms.** `update-electron-app` is wired in `main.cjs` but it requires a signed `.app` on macOS *and* a signed Windows installer. There is no skip-signing-ship-updates path. Don't promise an auto-update demo before signing is wired in CI.
7. **Ports stay deterministic.** The server-manager tries 3765 → 3766 → 3767 → 3768 only. Never an ephemeral high port — that would orphan `localStorage` on every restart. The BrowserWindow is pinned to `session.fromPartition("persist:weatherv1")` so storage is keyed by partition, not origin, and survives port fallback.
8. **Settings changes restart the child.** No hot-swap of env in the running Next child. `electron/server-manager.cjs` exposes `restart(env)`; the renderer is expected to show a "Reloading…" overlay until `/api/internal/health` returns green.
9. **`safeStorage` has a plaintext fallback.** On platforms without an OS keychain (typically headless Linux without a keyring), `electron/config.cjs` records `encryption: "none"` and stores the key as plaintext. The settings UI should surface this so the user knows.
10. **`npm ci` needs `package-lock.json` to match `package.json`.** Two CI runs (`25735788933`, `25736054166`) failed in this exact way when Step 6 added the Electron / Forge / ffmpeg deps without regenerating the lockfile. Fixed by committing the regenerated lockfile (`171a502`). Always run `npm install --package-lock-only --ignore-scripts` after touching `package.json` and commit both files together.
11. **Some dev shells inherit `ELECTRON_RUN_AS_NODE=1`.** In this environment, raw `electron .` made `require("electron").app` undefined. Use `npm run electron:dev`, which calls `scripts/run-electron.cjs` and clears that variable before launching the Electron binary.

## Remaining smoke tests

- Saving workspace/API key settings restarts the child and returns to a healthy app.
- Audio upload via native picker round-trips.
- Catalog video import via native picker round-trips.
- Render pipeline runs end to end with a user-chosen workspace.
- `npm run electron:make` produces unsigned local artifacts.
- Signed release artifacts are validated in CI after signing secrets are configured and the GitHub publisher block is intentionally enabled.

**Public download page:** Tags matching `v*` trigger the `release` job in `.github/workflows/desktop.yml`, which renames artifacts to `WeatherV1-macOS.zip` and `WeatherV1-Setup.exe` and publishes them with `softprops/action-gh-release`. Set **Settings → Pages → Build and deployment → Source: GitHub Actions** so `.github/workflows/pages.yml` can publish the templated download page (`docs/download-page/index.html.template` → site root).

## Verification checklist for the next pass

- [x] `npm test` 49/49
- [x] `tsc --noEmit` clean
- [x] `npm run build` produces `.next/standalone/server.js` at the correct path
- [x] `npm run standalone:prep` populates `public/` + `.next/static/`
- [x] `electron/ffmpeg-verify.cjs` returns `{ ok: true }` against system ffmpeg
- [x] `forge.config.cjs` loads cleanly with `packagerConfig.icon` + Squirrel `setupIcon` wired
- [x] Desktop-aware Settings/Upload/Catalog renderer wiring is in place
- [x] `.github/workflows/desktop.yml` is in place
- [x] `npm run electron:dev` boots and `/api/internal/health` returns 200
- [ ] Audio upload via native picker round-trips
- [ ] Catalog video import via native picker round-trips
- [ ] Render pipeline runs end to end with a user-chosen workspace
- [ ] `npm run electron:make` produces signed artifacts in CI

## App icon

Icon assets live in `build/`:

| File | How it was produced |
| --- | --- |
| `build/icon.icns` | `iconutil -c icns` from a 10-size `.iconset` built from `AppIcons.zip` |
| `build/icon.ico` | Node.js ICO packer — 6 sizes (16, 32, 48, 64, 128, 256) embedded as PNG blobs |

`forge.config.cjs` references both via `packagerConfig.icon: "build/icon"` (Forge appends `.icns`/`.ico` per platform) and `makers[Squirrel].config.setupIcon: "build/icon.ico"`. `electron/main.cjs` also sets `icon` on BrowserWindow for the dev-mode dock/taskbar icon.

To regenerate: drop a new `1024×1024 PNG` into `build/source-1024.png`, recreate the `.iconset` folder with `sips -Z <size>` for each required size, run `iconutil -c icns`, and re-run the ICO packer script from this session's Bash history (or write a fresh `scripts/build-icons.cjs`).

## Stop point

After icon integration. The next smoke tests are settings save, deliberate native picker round-trips, and `npm run electron:make` — unsigned locally, signed only on CI with the secrets above.
