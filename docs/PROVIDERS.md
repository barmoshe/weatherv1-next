# Providers (LLM + Transcription)

`weatherv1-next` no longer depends on OpenAI specifically. Both the LLM
calls (scene planning, segment picking) and audio transcription go through
small provider abstractions; the user picks providers in Settings, and
the server selects based on configured keys.

## Layout

```
src/server/providers/
  llm/
    types.ts           Provider interface + LlmProviderError
    anthropic.ts       Messages API + tool_use for structured JSON + ephemeral cache_control
    openai.ts          chat.completions + response_format json_object
    index.ts           getLlmProvider() selection
  transcription/
    types.ts           Provider interface + TranscriptionProviderError
    whisper-onnx.ts    transformers.js (ONNX) + ffmpeg → 16 kHz mono → Float32Array
    openai-cloud.ts    Lifts the original whisper-1 cloud call
    index.ts           getTranscriptionProvider() selection
  errors.ts            Single source of Hebrew → HTTP/error_code mapping for routes
src/server/whisper/
  models.ts            Model registry + downloader, backed by transformers.js env.cacheDir
```

There are no longer any vendored native binaries for Whisper. The `electron/bin/whisper/` slot is gone.

## LLM selection rules

`getLlmProvider()`:
1. `LLM_PROVIDER` env (`anthropic` | `openai`) — explicit pin. Errors if its
   key isn't set.
2. Auto: prefer `ANTHROPIC_API_KEY` over `OPENAI_API_KEY`.
3. No keys → `LlmProviderError("llm_invalid_key")` with an actionable
   Hebrew message in the API response.

Model defaults:
- Anthropic: `claude-sonnet-4-6`, overridable via `CLAUDE_MODEL`.
- OpenAI: `gpt-4o`, overridable via `OPENAI_MODEL`.

Anthropic specifics:
- JSON output is via **tool_use**. We declare a single tool whose
  `input_schema` is the Zod schema for the expected response and force
  `tool_choice: { type: "tool", name }`.
- The big static prompts in `pipeline/picker.ts` and `pipeline/scene-planner.ts`
  are marked `cache_control: { type: "ephemeral" }`. Repeat calls hit the
  5-minute cache and pay ~10% of normal input cost for the cached portion.

## Transcription selection rules

`getTranscriptionProvider()`:
1. `TRANSCRIPTION_PROVIDER` env (`local-whisper-onnx` | `openai-cloud`).
2. Auto: prefer local if at least one Whisper model is cached in the
   workspace; otherwise fall back to cloud Whisper if `OPENAI_API_KEY` is set.
3. Nothing usable → `TranscriptionProviderError("transcription_no_model")`.

The local provider:
- Uses `FFMPEG_PATH` (already plumbed for the rest of the app) to convert
  any input audio to 16 kHz mono PCM 16-bit WAV first.
- Loads the WAV through `wavefile` (re-sampled to 16 kHz f32 mono) so the
  ASR pipeline gets the `Float32Array` it expects.
- Constructs the `automatic-speech-recognition` pipeline from
  `@huggingface/transformers` against the active model's HuggingFace repo
  id, with `dtype` from the registry (`q4`/`q8`) and `device: "cpu"`. The
  pipeline is memoised across requests in the same process; swapping
  models in Settings disposes the previous session and constructs a new
  one on the next call.
- Calls the pipeline with
  `{ language: 'hebrew', task: 'transcribe', return_timestamps: true,
     chunk_length_s: 29, stride_length_s: 5 }`. `chunk_length_s` is 29 on
  purpose — `whisper-large-v3-turbo_timestamped` has a known timestamp
  artifact at exactly 30 s blocks.
- Maps the pipeline's `chunks: [{ timestamp: [start, end], text }]` output
  to the canonical `WhisperSegment[]`, clamping any backwards/overlapping
  timestamps the model occasionally emits at chunk boundaries.

### Why ONNX and not whisper.cpp?

The previous build shelled out to a vendored `whisper-cli` native binary.
Upstream `whisper.cpp` ships prebuilt binaries only for Windows zips, so
macOS users saw "תוכנת whisper.cpp לא נמצאה" until they
`brew install whisper-cpp` (which the Electron child PATH usually couldn't
see anyway). The released app on both Mac and Windows hit this failure
mode. `@huggingface/transformers` runs Whisper as ONNX in pure JS via
`onnxruntime-node` — one `npm install`, no per-OS vendored binary, no
`app.asar.unpacked` dance for the engine itself.

### Native module support

`onnxruntime-node@1.24.3` ships prebuilt binaries for:
- `darwin/arm64` (Apple Silicon)
- `linux/arm64`, `linux/x64`
- `win32/arm64`, `win32/x64`

It does **not** ship `darwin/x64`. Microsoft dropped Intel Mac prebuilds
in 1.21+. Practical implications:
- Mac releases are arm64-only. Forge defaults to packaging for the host
  architecture; build the Mac release on Apple Silicon.
- An Intel-Mac developer running `npm run electron:dev` will see the
  pipeline fail to load. The provider catches this and surfaces a Hebrew
  error in the UI rather than crashing the server.

## Models

- Models live under `<runtime>/cache/whisper-onnx/` (workspace cache, not
  the installer bundle). transformers.js owns the layout — it caches each
  repo as a folder tree of ONNX/JSON files keyed off the HuggingFace repo
  id.
- Three IDs are exposed today (see `src/server/whisper/models.ts`):
  - `small` → `Xenova/whisper-small` (~250 MB, q8). Dev/demo quality.
  - `medium` → `Xenova/whisper-medium` (~850 MB, q8). Recommended default
    for Hebrew.
  - `large-v3-turbo` → `onnx-community/whisper-large-v3-turbo_timestamped`
    (~1.6 GB, q4). Best Hebrew quality; fine-tuned for accurate segment
    timestamps.
- Downloads piggyback on transformers.js's own `progress_callback`. We
  aggregate per-file `loaded/total` and emit a single `DownloadProgress`
  event per change, so the SSE shape feeding the Settings UI matches the
  legacy GGML downloader.
- After a successful pipeline construction we write a `.weatherv1-verified`
  marker file next to the cache subtree so subsequent boots know the
  download is complete (transformers.js itself doesn't ship a manifest).
- `WHISPER_MODEL` env override lets ops force a specific model when more
  than one is installed.

SHA-256 verification is intentionally dropped — each ONNX repo is many
files (encoder/decoder/tokenizer JSONs + binaries) and re-pinning would be
high-friction with little payoff over the HuggingFace ETag protection
transformers.js already uses on download.

## API surface

- `GET /api/whisper/models` — list, install state, active model, repo id,
  cache directory.
- `POST /api/whisper/models` (`{ model_id }`) — start a download. Streams
  aggregated transformers.js progress as Server-Sent Events.
- `DELETE /api/whisper/models?model_id=<id>` — remove the cached subtree
  and the `.weatherv1-verified` marker.
- `GET /api/desktop/status` — includes `keys.anthropic_configured`,
  `whisper.active_model`, `whisper.installed_models`, `whisper.local_ready`,
  `providers.llm_pref`, `providers.transcription_pref`,
  `providers.transcription_active` (resolves to `local-whisper-onnx` or
  `openai-cloud`).

All routes sit behind `assertDesktopAuth`.

## Error contract

`src/server/providers/errors.ts::mapProviderError(err)` returns a
`{ body, status }` shape used uniformly by `/api/plan`,
`/api/replan_scene`, and `/api/transcribe`. Stable `error_code`s:

- `llm_invalid_key`, `llm_quota_exceeded`, `llm_rate_limited`,
  `llm_overloaded`, `llm_unknown`
- `transcription_invalid_key`, `transcription_quota_exceeded`,
  `transcription_no_model`, `transcription_failed`

The legacy `transcription_binary_missing` code is folded into
`transcription_no_model` — the old binary slot doesn't exist anymore.
`provider` is also included on every response so the UI can show which
provider hit the error.

## Packaging

The Electron build relies on three things to ship transformers.js correctly:

1. `next.config.ts` lists `@huggingface/transformers`, `onnxruntime-node`,
   `sharp`, and `wavefile` in `serverExternalPackages` (and aliases
   `onnxruntime-node` / `sharp` to `false` on the client) so webpack
   doesn't try to bundle native code into the Next runtime.
2. `forge.config.cjs` adds `**/node_modules/onnxruntime-node/**`,
   `**/node_modules/@huggingface/transformers/**`, and
   `**/node_modules/wavefile/**` to `asarUnpack`. `auto-unpack-natives`
   only catches `*.node` files; the `.dylib`/`.dll` siblings need an
   explicit glob.
3. `scripts/prepare-standalone.cjs` copies all three packages into
   `.next/standalone/node_modules/` so Next's standalone tracing (which
   may miss dynamically-required platform binaries) doesn't drop them.

## Settings UX

`SettingsModal` exposes:
- Anthropic key + OpenAI key + Gemini key
- LLM provider radio: Auto / Anthropic / OpenAI
- Transcription provider radio: Auto / Local Whisper (ONNX) / Cloud Whisper
- Whisper Models panel: download/delete per model, progress bar, active
  marker. No binary install step — the runtime is bundled inside the app.
