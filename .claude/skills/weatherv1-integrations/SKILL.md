---
name: weatherv1-integrations
description: Manage and analyse WeatherV1's external integrations — LLM providers (Anthropic, OpenAI), Whisper transcription, ffmpeg, Gemini fallback, API keys, error codes, and cost-rate maintenance. Use when switching providers, diagnosing a 401/429/quota error from /api/plan or /api/transcribe, bumping the cost-estimate pricing revision, or auditing which keys are required.
---

# WeatherV1 Integrations

Thin router for everything in `src/server/providers/**` plus the cost-estimate
table in `src/server/billing/usage-cost.ts`. The canonical doc is
[`docs/PROVIDERS.md`](../../../docs/PROVIDERS.md); read it first — this skill
is a navigator, not a duplicate.

## Load Order

1. `docs/PROVIDERS.md` — provider abstraction summary, what ships today.
2. `src/server/providers/llm/index.ts` — selection precedence (Anthropic >
   OpenAI; `LLM_PROVIDER` env override; `configFromEnv()` for runtime keys).
3. `src/server/providers/llm/anthropic.ts` — Messages API + tool-use JSON
   enforcement; default model `claude-sonnet-4-6`; ephemeral system-prompt
   cache markers (`cache_control: { type: "ephemeral" }`).
4. `src/server/providers/llm/openai.ts` — Chat Completions + `response_format:
   { type: "json_object" }`; default `gpt-4o`; surfaces
   `prompt_tokens_details.cached_tokens` for prefix-cache discount.
5. `src/server/providers/transcription/index.ts` +
   `src/server/providers/transcription/openai-cloud.ts` — Whisper-only;
   hard-requires `OPENAI_API_KEY` even when LLM provider is Anthropic.
6. `src/server/providers/errors.ts` — stable error code map
   (`llm_invalid_key`, `llm_quota_exceeded`, `llm_rate_limited`,
   `llm_overloaded`, `llm_invalid_response`, `transcription_invalid_key`,
   `transcription_quota_exceeded`, `transcription_failed`).
7. `src/server/billing/usage-cost.ts` — `PRICING_REVISION` constant, the
   per-MTok env overrides (`ANTHROPIC_SONNET_INPUT_PER_MTOK_USD`,
   `OPENAI_GPT4O_INPUT_PER_MTOK_USD`, …), Whisper rate, cached-token
   discount math.

## Inspecting Active Provider

- Server: read `LLM_PROVIDER`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` from the
  environment the Next process saw — `configFromEnv()` is the source of
  truth.
- Desktop: keys are injected by the Electron main process into the child
  server at spawn. Never read renderer `localStorage` for keys — the
  `CLAUDE.md` safety rule mandates `safeStorage`.
- Per-call provenance: every LLM call lands in `usage_calls[*].provider`
  and `usage_calls[*].model` on the job record, so a single
  `runtime/jobs.json` lookup reveals which provider actually ran.

## Diagnosing a Provider Failure

1. Find the HTTP status the route returned (`/api/plan`,
   `/api/replan_scene`, `/api/transcribe`).
2. Map it to a code via `src/server/providers/errors.ts` — the same map is
   what the UI renders.
3. Reproduce minimally: a one-scene replan (`POST /api/replan_scene`) is
   cheaper than a full plan when iterating on a 429.
4. If the failure is `llm_overloaded`, `llm_rate_limited`, or
   `transcription_quota_exceeded`, it's upstream — don't change code, retry
   later or switch `LLM_PROVIDER`.

## Cost-Rate Maintenance

When Anthropic/OpenAI publish new list pricing:

1. Edit the per-MTok constants (or env defaults) in
   `src/server/billing/usage-cost.ts`.
2. **Bump `PRICING_REVISION`** in the same file. Historical jobs keep their
   old stamp; the UI uses the stamp to label which estimate revision a job
   was costed under. Never silently re-estimate old jobs.
3. Run the cost test: `npm test -- src/test/usage-cost.test.ts`.

## Default Checks

- `npx tsc --noEmit`
- `npm test`
- `npm test -- src/test/usage-cost.test.ts` for any `usage-cost.ts` edit.

## What This Skill Does Not Do

- Rotate the R2 Worker's Basic-auth secrets — that's `weatherv1-r2` +
  `docs/RUNBOOK_WORKER_ROTATION.md`.
- Edit the Electron `safeStorage` flow for renderer-side key persistence.
- Add a new provider. New provider integration warrants a `docs/future/`
  proposal first.
