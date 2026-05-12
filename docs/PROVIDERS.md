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
    whispercpp-local.ts  Spawns bundled whisper-cli, ffmpeg-converts to 16 kHz mono WAV first
    openai-cloud.ts    Lifts the original whisper-1 cloud call
    index.ts           getTranscriptionProvider() selection
  errors.ts            Single source of Hebrew → HTTP/error_code mapping for routes
src/server/whisper/
  binary.ts            Resolves the whisper-cli binary (env > bundled > PATH)
  models.ts            Model registry, download manager, SHA verification
electron/bin/whisper/  Bundling slot for prebuilt whisper-cli binaries (see README)
```

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
1. `TRANSCRIPTION_PROVIDER` env (`local-whispercpp` | `openai-cloud`).
2. Auto: prefer local if the whisper binary is resolvable *and* a model is
   installed; otherwise fall back to cloud Whisper if `OPENAI_API_KEY` is set.
3. Nothing usable → `TranscriptionProviderError`.

The local provider:
- Uses `FFMPEG_PATH` (already plumbed for the rest of the app) to convert
  any input audio to 16 kHz mono PCM WAV first.
- Spawns `whisper-cli -m <model> -f <wav> -l he --prompt "<WHISPER_HE_PROMPT>" -oj -of <prefix>`.
- Parses the `<prefix>.json` sidecar, applies `fixTranscript`, returns the
  canonical `TranscriptionResult` shape.

## Bundled whisper.cpp binary

`electron/bin/whisper/<platform>-<arch>/whisper-cli[.exe]` is the slot. It's
listed in `forge.config.cjs`'s `asarUnpack` so executables survive
packaging. The binary is **not** in git — vendor it from
[ggerganov/whisper.cpp releases](https://github.com/ggerganov/whisper.cpp/releases)
during a release engineering pass and `chmod +x` on macOS targets. See
`electron/bin/whisper/README.md`.

If you ship a build without a bundled binary, the resolver falls back to
`WHISPER_CLI_PATH` and then to system `PATH` (`whisper-cli`, `whisper.cpp`,
`main`). `/api/desktop/status` reports `whisper.binary_ready` so the UI can
show the right state.

## Models

- Models live in `<runtime>/cache/whisper-models/` (workspace cache, not the
  installer bundle). Files are `ggml-<id>.bin` from
  `huggingface.co/ggerganov/whisper.cpp`.
- Three IDs are exposed: `small`, `medium`, `large-v3`. `medium` is the
  pragmatic default for Hebrew. `large-v3` is the quality default if disk
  and CPU allow.
- Downloads are streamed and SHA-256 verified when a pinned hash is set in
  `src/server/whisper/models.ts`. Pinning is a release-engineering task —
  the scaffolded values are `null`, which downloads with a logged warning.
- `WHISPER_MODEL` env override lets ops force a specific model when more
  than one is installed.

## API surface

- `GET /api/whisper/models` — list, install state, active model, binary state.
- `POST /api/whisper/models` (`{ model_id }`) — start a download, streams
  progress as Server-Sent Events.
- `DELETE /api/whisper/models?model_id=<id>` — remove.
- `GET /api/desktop/status` — includes `keys.anthropic_configured`,
  `whisper.binary_ready`, `whisper.active_model`, `whisper.local_ready`,
  `providers.llm_pref`, `providers.transcription_pref`.

All routes sit behind `assertDesktopAuth`.

## Error contract

`src/server/providers/errors.ts::mapProviderError(err)` returns a
`{ body, status }` shape used uniformly by `/api/plan`,
`/api/replan_scene`, and `/api/transcribe`. Stable `error_code`s:

- `llm_invalid_key`, `llm_quota_exceeded`, `llm_rate_limited`,
  `llm_overloaded`, `llm_unknown`
- `transcription_invalid_key`, `transcription_quota_exceeded`,
  `transcription_no_model`, `transcription_binary_missing`,
  `transcription_failed`

The legacy `openai_invalid_key` / `openai_quota_exceeded` codes are gone;
clients should branch on the new codes. `provider` is also included so the
UI can show which provider hit the error.

## Settings UX

`SettingsModal` exposes:
- Anthropic key + OpenAI key + Gemini key
- LLM provider radio: Auto / Anthropic / OpenAI
- Transcription provider radio: Auto / Local Whisper / Cloud Whisper
- Whisper Models panel: download/delete per model, progress bar, active
  marker
