# Desktop package size — report & recommendations

_(Report)_ The short answer to "why is the desktop app ~5 GB" plus a ranked fix list, grounded in a measurement of the real installed app. Evidence in [desktop-size-research.md](desktop-size-research.md); the executable checklist is [desktop-size-tasks.md](desktop-size-tasks.md).

## Status — implemented & measured

Two safe optimizations landed in [`forge.config.cjs`](../../forge.config.cjs): (1) exclude root-only server deps from the asar, (2) strip foreign-OS `ffprobe-static` binaries. Re-packaged result on macOS x64:

| | before | after |
| --- | --- | --- |
| total `.app` | 1.2 GB | **707 MB** (−41%) |
| `app.asar` | 355 MB | 177 MB |
| `app.asar.unpacked` | 591 MB | 274 MB |

Verified: excluded dirs are empty stubs, the `.next/standalone` tree is intact, ffprobe ships darwin-only, all four main-process packages remain. **Still required before release:** a packaged launch + render smoke-test (the trim only fails at runtime).

## The one-paragraph answer

The **macOS** install is **1.2 GB**, not 5 GB — so the 5 GB is **Windows-specific**, and it is almost certainly the **Squirrel install layout**, not one bloated binary: Squirrel.Windows keeps versioned `app-<version>\` folders plus a full `.nupkg` (~1.2 GB) and deltas under `%LocalAppData%\weatherv1\`, which stack to ~5 GB after a couple of updates. Separately, on **both** platforms, `app.asar` carries ~400–450 MB of **dead weight**: the root `node_modules` ships `next` (169 MB), `@next`/swc (~114 MB packed + ~114 MB unpacked), and root copies of server-only libs (`openai`, `@anthropic-ai`, `@tanstack`, `zod`, `lodash`, `react-dom`) that the Electron main process never loads — the Next server already has its own self-contained copies in `.next/standalone/node_modules`. devDependency pruning already runs (confirmed: `typescript`/`vitest`/`jsdom`/`electron` are absent), but it can't remove production deps; `@pulumi` and `@electron-forge` slipped through as a prune miss.

## Ranked culprits (measured, macOS)

| # | Culprit | Size | Status |
| --- | --- | --- | --- |
| 1 | Windows Squirrel multi-copy (`app-<ver>` + full/delta `.nupkg`) | ~5 GB on disk | **Measure on Windows — likely the 5 GB driver** |
| 2 | `ffprobe-static` (asar-unpacked) | 335 MB | Load-bearing — keep (verify single arch) |
| 3 | root `next` in asar | 169 MB | **Dead weight — remove** (standalone has its own) |
| 4 | root `@next`/swc (packed + unpacked) | ~228 MB | **Dead weight — remove** (standalone needs 16 KB) |
| 5 | Electron Framework | 238 MB | Necessary (the shell) |
| 6 | `ffmpeg-static` (asar-unpacked) | 75 MB | Load-bearing — keep |
| 7 | root server-only libs (`openai`, `@anthropic-ai`, `@tanstack`, `zod`, `lodash`, `react-dom`) | ~40 MB | **Dead weight — remove** |
| 8 | `@pulumi` + `@electron-forge` (prune miss) | — | **Dead weight — remove** |

> Not a culprit: `runtime/` (Whisper model + dev MP4s, ~769 MB) is excluded at [`forge.config.cjs:79`](../../forge.config.cjs)/[`:86`](../../forge.config.cjs) — local-only, never shipped.

## Recommendations (ranked by impact / effort / risk)

### High impact, low risk — trim root node_modules from the asar
Add a selective rule to the `ignore` array in [`forge.config.cjs`](../../forge.config.cjs) that drops root-level packages the **main process never requires** — their copies live in `.next/standalone/node_modules`:
`next`, `@next`, `openai`, `@anthropic-ai`, `@tanstack`, `react`, `react-dom`, `zod`, `zod-to-json-schema`, `lodash`, `@pulumi`, `@electron-forge`.

- **Do NOT** blanket-ignore `/node_modules` — that deletes the asar-unpacked `ffmpeg-static`/`ffprobe-static` and the main-process packages (`update-electron-app`, `electron-squirrel-startup`).
- Keep from root: `update-electron-app`, `electron-squirrel-startup`, `ffmpeg-static`, `ffprobe-static`.
- **Expected saving:** ~400–450 MB → macOS app ~1.2 GB → ~0.8 GB. On Windows this shrinks *every* Squirrel copy, so the win multiplies.

### Investigate first / highest leverage on Windows — Squirrel footprint
Measure `%LocalAppData%\weatherv1\` on a Windows box: how many `app-<ver>` folders are retained, and the size of the full vs delta `.nupkg`. This decides whether the 5 GB is "shrink the asar" or "manage Squirrel retention" (or both). Reframes the headline number.

### Medium — packaging hygiene
- Confirm `ffprobe-static` ships **one** platform binary (335 MB is large for a single arch).
- Consider max asar compression.
- Run `depcheck` for genuinely unused dependencies.

## Do-not-regress notes

- Keep `ffmpeg-static` + `ffprobe-static` **asar-unpacked** ([`forge.config.cjs:66`](../../forge.config.cjs)) — executables can't run from inside asar.
- Keep `runtime/` and `.next/standalone/runtime` **ignored** ([`forge.config.cjs:79`](../../forge.config.cjs), [`:86`](../../forge.config.cjs)).
- Keep `electron-squirrel-startup` and `update-electron-app` available to the main process.
- After any ignore change, **smoke-test a packaged build**: launch it, run a render (exercises ffmpeg), confirm auto-update wiring loads. A missing transitive dep only surfaces at runtime.
