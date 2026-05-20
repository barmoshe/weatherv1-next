# Desktop package size — research log

_(Research)_ Why the packaged WeatherV1 desktop app is large (~5 GB observed on Windows), measured against the real installed app. Companion to [desktop-size-report.md](desktop-size-report.md) (recommendations) and [desktop-size-tasks.md](desktop-size-tasks.md) (action checklist).

## Goal

Establish, from a real package rather than guesswork, what ships inside the app and which parts are dead weight — so a slimming pass targets the right thing.

## Methodology

- **Measured the real installed macOS app** at `/Applications/WeatherV1.app` (`du -sh`, then extracted `app.asar` with `npx @electron/asar extract` and measured the tree inside).
- Read packaging config: [`forge.config.cjs`](../../forge.config.cjs), [`package.json`](../../package.json), [`scripts/prepare-standalone.cjs`](../../scripts/prepare-standalone.cjs), [`next.config.ts`](../../next.config.ts).
- Traced the Electron main-process entry [`electron/main.cjs`](../../electron/main.cjs) and [`electron/ffmpeg-verify.cjs`](../../electron/ffmpeg-verify.cjs) for binary resolution.
- Web search on Electron slimming (sources below).

## Headline: macOS is 1.2 GB, Windows is ~5 GB

The installed **macOS** app is **1.2 GB**, not 5 GB. The ~5 GB the user saw is **Windows-specific** — see _Two distinct problems_ below. macOS sizes are exact (measured); Windows is a strong hypothesis pending measurement on a Windows box.

## Measured macOS bundle (`/Applications/WeatherV1.app` — 1.2 GB)

| Path | Size |
| --- | --- |
| `Contents/Resources/app.asar` (packed) | 355 MB |
| `Contents/Resources/app.asar` (extracted) | 1.0 GB |
| `Contents/Resources/app.asar.unpacked` | 591 MB |
| `Contents/Frameworks/Electron Framework.framework` | 238 MB |
| `Contents/Resources/bg-music` | 4.2 MB |

### Inside `app.asar` — `node_modules` is 794 MB (extracted)

| Package (root node_modules in asar) | Size | Verdict |
| --- | --- | --- |
| `ffprobe-static` | 335 MB | **Keep** — asar-unpacked, render-critical |
| `next` | 169 MB | **Dead weight** — standalone has its own 15 MB copy |
| `@next` (swc) | 114 MB | **Dead weight** — standalone needs only 16 KB; ~114 MB more sits in `app.asar.unpacked` |
| `ffmpeg-static` | 75 MB | **Keep** — asar-unpacked, render-critical |
| `@img` (sharp) | 18 MB | Server-side (posters); standalone has its own |
| `openai` | 9.6 MB | Dead weight at root (standalone server traced) |
| `@anthropic-ai` | 7.6 MB | Dead weight at root |
| `react-dom` | 7.1 MB | Dead weight at root (standalone has 1.3 MB) |
| `lodash` | 4.9 MB | Dead weight at root |
| `@tanstack` | 4.7 MB | Dead weight at root |
| `caniuse-lite` | 4.1 MB | Dead weight at root |
| `zod` | 3.9 MB | Dead weight at root |
| `update-electron-app` | 3.0 MB | **Keep** — main process requires it |

### Inside `app.asar.unpacked` — 591 MB

`ffprobe-static` 335 MB + `ffmpeg-static` 75 MB + `@next`/swc native ~114 MB + `argon2` + `@img`. ffmpeg/ffprobe are render-critical; the `@next`/swc copy here is dead weight (the standalone server does not compile at runtime).

## Measured after slimming (macOS x64)

After landing the two `forge.config.cjs` optimizations (exclude root-only server deps; strip foreign-OS ffprobe binaries) and re-running `npm run electron:build`:

| | before | after | delta |
| --- | --- | --- | --- |
| total `.app` | 1.2 GB | 707 MB | −493 MB (−41%) |
| `app.asar` (packed) | 355 MB | 177 MB | −50% |
| `app.asar.unpacked` | 591 MB | 274 MB | −54% |

Sanity checks: excluded dirs (`next`, `@next`, `openai`, `react-dom`) appear in the asar as **0-child empty stubs**; `.next/standalone/node_modules/next` is intact (1110 entries); `ffprobe-static/bin` ships **darwin only**; `update-electron-app`/`electron-squirrel-startup`/`ffmpeg-static`/`ffprobe-static` all present. The unpacked drop is the foreign ffprobe (~203 MB) + `@next`/swc native (~114 MB).

## Verified facts

### `prune` ran (mostly)

These devDependencies are **confirmed absent** from the asar — electron-packager's default `prune` removed them: `typescript`, `vitest`, `jsdom`, `repomix`, `electron`.

**Two devDeps survived prune** and still ship: `@pulumi`, `@electron-forge`. These are a prune miss and pure dead weight.

> This disproves the earlier (pre-measurement) hypothesis that "prune may not be running." It runs; the real dead weight is **production dependencies** that prune cannot drop because the Next server declares them as `dependencies` even though the *main process* never loads them.

### The standalone server is self-contained

`.next/standalone` (65 MB) carries its own traced `node_modules` (43 MB) with its own `next` (15 MB), `react`, `react-dom` (1.3 MB), `sharp`, `lodash`, and the full `archiver` closure copied by [`scripts/prepare-standalone.cjs`](../../scripts/prepare-standalone.cjs). The server runs with `cwd` = `.next/standalone/` and does **not** fall back to root `node_modules`. This is what makes the duplicated root copies removable.

### What the main process actually needs from root node_modules

[`electron/main.cjs`](../../electron/main.cjs) loads only two third-party packages, both optional/try-catch: `electron-squirrel-startup` and `update-electron-app`. Everything else under `electron/` is Node builtins or relative requires.

### Load-bearing — must stay

`ffmpeg-static` + `ffprobe-static` (~410 MB) are asar-unpacked via the glob at [`forge.config.cjs:66`](../../forge.config.cjs) and resolved at runtime by [`electron/ffmpeg-verify.cjs`](../../electron/ffmpeg-verify.cjs), which rewrites `app.asar → app.asar.unpacked` at call time. `ffprobe-static` at 335 MB is large for one platform — confirm it ships a single arch (see tasks).

### `runtime/` does not ship

The 769 MB of Whisper model + dev MP4 outputs in the working copy is excluded at [`forge.config.cjs:79`](../../forge.config.cjs) and [`:86`](../../forge.config.cjs). It inflates the dev checkout on disk but is not in the package.

## Two distinct problems

1. **Removable asar dead weight (both platforms).** ~400–450 MB: root `next` (169 MB) + `@next`/swc (~114 MB packed + ~114 MB unpacked) + server-only libs (`openai`, `@anthropic-ai`, `@tanstack`, `zod`, `lodash`, `react-dom`, ~40 MB) + the `@pulumi`/`@electron-forge` prune miss. The main process never loads any of these; the standalone server has its own traced copies.
2. **Windows 5 GB ≈ Squirrel install layout, not a bloated binary.** Squirrel.Windows installs to `%LocalAppData%\weatherv1\` and keeps versioned `app-<version>\` folder(s) plus a full `.nupkg` (~1.2 GB) and deltas in `packages\`. After a couple of updates these stack: ~3 copies × ~1.2 GB ≈ 5 GB. Trimming the asar shrinks *every* copy, so the two fixes compound. **Needs confirmation on a Windows box** (`%LocalAppData%\weatherv1` size breakdown).

## Web research — Electron slimming (Feb–May 2026)

Standard levers, in rough impact order:
1. **Prune devDependencies** (already happening here; the remaining weight is production deps).
2. **Treemap analysis** to find the real culprits (extract asar + `du`, done above).
3. **Selective `ignore`** of packages the shipped process doesn't load.
4. **`asar` compression** (`maximum`).
5. **`depcheck`** for unused dependencies.
6. **Swap heavy libraries** for lean alternatives.

### Sources

- [How to Reduce Electron Package Size — xjavascript.com](https://www.xjavascript.com/blog/electron-package-reduce-the-package-size/)
- [Why Is My Electron Builder App Size Too Large? — codestudy.net](https://www.codestudy.net/blog/electron-builder-app-size-is-too-large/)
- [Optimizing Electron JS Apps: Reduce Package Size — Medium](https://medium.com/@paolo.c/optimizing-electron-js-apps-improve-security-and-reduce-package-size-81f33398de9a)
- [app.asar size is huge with electron-builder · Issue #6045](https://github.com/electron-userland/electron-builder/issues/6045)
