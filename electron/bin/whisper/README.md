# Bundled whisper.cpp binaries

This directory is the bundling slot for the `whisper-cli` binary, mirroring the
`ffmpeg-static` / `ffprobe-static` pattern used elsewhere in the app.
`forge.config.cjs` has this path in its `asarUnpack` glob so the binary is
materialized at `Resources/app.asar.unpacked/electron/bin/whisper/<platform-arch>/`
in packaged builds and remains executable.

## Layout

```
electron/bin/whisper/
  darwin-arm64/whisper-cli
  darwin-x64/whisper-cli
  win32-x64/whisper-cli.exe
```

The path resolver is `src/server/whisper/binary.ts`. It looks at
`WHISPER_CLI_PATH` first, then this directory (with the right `<platform>-<arch>`),
then PATH.

## Vendoring

1. Visit https://github.com/ggerganov/whisper.cpp/releases and grab the latest
   `whisper-cli` build for each target platform. For macOS arm64 prefer the
   Metal-enabled build.
2. Copy the binary into the matching folder. On macOS targets, `chmod +x`.
3. Re-run `npm run electron:build` to verify Forge picks it up.
4. macOS notarization: the existing `osxSign` block in `forge.config.cjs`
   uses `signatureFlags: "library"`, which already covers nested binaries —
   nothing extra is needed beyond the existing Apple secrets in CI.

## Runtime behaviour without bundled binaries

If you ship a build without a bundled binary, `resolveWhisperBinary()` falls
through to `WHISPER_CLI_PATH` (env override) and then to the system `PATH`
(`whisper-cli`, `whisper.cpp`, `main`). The `/api/desktop/status` endpoint
reports `whisper.binary_ready: false` in that case and the Settings UI shows
the local-Whisper option as unavailable.
