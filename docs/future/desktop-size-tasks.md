# Desktop package size — task checklist

_(Tasks)_ Ordered action list to slim the packaged desktop app. Background in [desktop-size-research.md](desktop-size-research.md); rationale in [desktop-size-report.md](desktop-size-report.md).

## Phase 1 — Measure & diagnose ✅ DONE
- [x] Measure the real installed macOS app (`/Applications/WeatherV1.app` = 1.2 GB; `app.asar` 355 MB packed / 1.0 GB extracted; `app.asar.unpacked` 591 MB).
- [x] Extract the asar and identify dead weight (root `next` 169M, `@next` ~228M packed+unpacked, server libs ~40M).
- [x] Confirm whether `prune` runs — it does (`typescript`/`vitest`/`jsdom`/`electron` absent); `@pulumi`/`@electron-forge` are a prune miss.
- [x] Record measured numbers in [desktop-size-research.md](desktop-size-research.md).

## Phase 2 — Trim the asar ✅ DONE
- [x] Added root-anchored `ignore` regexes in [`forge.config.cjs`](../../forge.config.cjs) dropping root-only server deps (`next`, `@next`, `react`, `react-dom`, `scheduler`, `openai`, `@anthropic-ai`, `@tanstack`, `zod`, `zod-to-json-schema`, `lodash`, `caniuse-lite`, `@pulumi`, `@electron-forge`). Native-binding pkgs (`@img`/`sharp`, `argon2`) left in place.
- [x] Strip foreign-OS `ffprobe-static` binaries for the target platform (`bin/win32`, `bin/linux` dropped on a macOS build).
- [x] Kept from root: `update-electron-app`, `electron-squirrel-startup`, `ffmpeg-static`, `ffprobe-static`.
- [x] Re-packaged (`npm run electron:build`) and measured. Verified excluded dirs have **0 child entries** (empty stubs) and the standalone tree's own `next` (1110 entries) is intact.

**Measured (macOS x64):**
| | before | after | delta |
| --- | --- | --- | --- |
| total `.app` | 1.2 GB | **707 MB** | −41% |
| `app.asar` (packed) | 355 MB | **177 MB** | −50% |
| `app.asar.unpacked` | 591 MB | **274 MB** | −54% |

## Phase 3 — Smoke-test the slimmed package ✅ DONE (macOS)
- [x] Launched the packaged `out/WeatherV1-darwin-x64/WeatherV1.app` (isolated `--user-data-dir`). The standalone server spawned from `app.asar.unpacked`, reached **`✓ Ready`** on 3765, loaded the catalog, and served **HTTP 200** — no `MODULE_NOT_FOUND` / `Cannot find module`. Confirms the node_modules trim didn't break server-side module resolution.
- [ ] Still untested: a full **render** (exercises ffmpeg/ffprobe via [`electron/ffmpeg-verify.cjs`](../../electron/ffmpeg-verify.cjs)) — boot proves module resolution but not an end-to-end render. Run when convenient.
- [ ] Windows: only the per-platform ffprobe binary differs; the node_modules trim is identical, so the macOS boot result is a strong proxy. A Windows launch is still worth a one-time check.

## Phase 4 — Windows footprint (highest leverage on the 5 GB)
- [ ] On a Windows box, measure `%LocalAppData%\weatherv1\`: count retained `app-<version>\` folders and the size of the full vs delta `.nupkg` under `packages\`.
- [ ] Confirm whether the 5 GB is Squirrel multi-copy (likely) vs a single bloated binary.
- [ ] Decide if `app-<ver>` retention / delta cleanup needs tuning.
- **Files:** `@electron-forge/maker-squirrel` config at [`forge.config.cjs:127`](../../forge.config.cjs).

## Phase 5 — Packaging hygiene (lower priority)
- [ ] Confirm `ffprobe-static` ships only one platform binary (335 MB is large for a single arch); strip others if present.
- [ ] Run `npx depcheck` to find genuinely unused dependencies.
- [ ] Consider max asar compression.

---

When this work ships, move all three `desktop-size-*.md` files to [`../archive/`](../archive/) and update [`../DOCS_INDEX.md`](../DOCS_INDEX.md) per the [README](README.md) convention.
