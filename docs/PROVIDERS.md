# Providers (LLM + Transcription)

`weatherv1-next` keeps a small provider abstraction so the LLM calls
(scene planning, segment picking) and audio transcription don't depend
on a single vendor. Today we ship:

- **LLM**: Anthropic (Claude) or OpenAI (GPT-4o), user-pickable in Settings.
- **Transcription**: OpenAI Whisper cloud only.

The provider shape supports plugging in a local transcription engine without touching call sites.

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
    openai-cloud.ts    whisper-1 cloud call (Hebrew prompt + segment timestamps)
    index.ts           getTranscriptionProvider() — cloud-only today
  errors.ts            Single source of Hebrew → HTTP/error_code mapping for routes
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
- The big static prompts in `pipeline/picker.ts` and
  `pipeline/scene-planner.ts` are marked
  `cache_control: { type: "ephemeral" }`. Repeat calls hit the 5-minute
  cache and pay ~10% of normal input cost for the cached portion.

## Transcription

`getTranscriptionProvider()` returns the OpenAI cloud provider when
`OPENAI_API_KEY` is set, otherwise throws
`TranscriptionProviderError("transcription_invalid_key")`. The route
layer surfaces that as a Hebrew message in the UI.

The cloud provider hands the audio file to `whisper-1` with a Hebrew
language hint and our domain-specific Hebrew prompt
(`WHISPER_HE_PROMPT` in `src/server/pipeline/transcript-fixes.ts`), then
runs the transcript through `fixTranscript()` for known
mistranscriptions before returning canonical `WhisperSegment[]`.

## API surface

- `GET /api/desktop/status` — includes `keys.anthropic_configured`,
  `keys.openai_configured`, `providers.llm_pref`, `providers.llm_active`,
  `providers.llm_model`, `providers.transcription_active` (resolves to
  `openai-cloud` when a key is configured, otherwise `null`).

All routes sit behind `assertDesktopAuth`.

## Error contract

`src/server/providers/errors.ts::mapProviderError(err)` returns a
`{ body, status }` shape used uniformly by `/api/plan`,
`/api/replan_scene`, and `/api/transcribe`. Stable `error_code`s:

- `llm_invalid_key`, `llm_quota_exceeded`, `llm_rate_limited`,
  `llm_overloaded`, `llm_unknown`
- `transcription_invalid_key`, `transcription_quota_exceeded`,
  `transcription_failed`

`provider` is included on every response so the UI can show which
provider hit the error.

## Settings UX

`SettingsModal` exposes:
- Anthropic key + OpenAI key + Gemini key
- LLM provider radio: Auto / Anthropic / OpenAI
- A short note: transcription runs through OpenAI Whisper cloud, so an
  OpenAI key is required to transcribe even if the LLM is Anthropic.
