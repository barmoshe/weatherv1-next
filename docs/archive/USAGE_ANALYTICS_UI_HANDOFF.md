# Analytics & usage UI — handoff for styling

Purpose: this document helps a **UX/UI agent** redesign styling for **per-job LLM + Whisper usage**, **estimated costs**, and the **Analytics** tab. Behaviour and data shapes are implemented; visual polish is intentionally minimal.

## Goal for end users

- See **approximate** USD cost and **token counts** per job (LLM in/out from scene planner + picker; transcription from billed audio seconds).
- Costs are **local estimates** from snapshot rates (`usage_summary.pricing_revision`), not invoices. Official billing is always the provider console.
- Analytics tab aggregates **LLM vs transcription** spend and **totals** across synced jobs.

## Canonical vendor pricing links (for disclaimers in UI)

- OpenAI: https://openai.com/api/pricing/
- OpenAI Whisper model page: https://developers.openai.com/api/docs/models/whisper-1
- Anthropic: https://www.anthropic.com/pricing  
- Anthropic prompt caching: https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching

## Surfaces & files

| Surface | File |
|--------|------|
| Analytics tab (URL `?tab=analytics`) | [`src/client/hooks/useTabFromUrl.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/client/hooks/useTabFromUrl.ts), [`src/client/components/TabNav.tsx`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/client/components/TabNav.tsx) |
| Analytics dashboard (structure + inline layout spacers) | [`src/client/components/jobs/AnalyticsPanel.tsx`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/client/components/jobs/AnalyticsPanel.tsx), wired from [`src/app/page.tsx`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/app/page.tsx) |
| Job row usage snippet | [`src/client/components/jobs/JobRow.tsx`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/client/components/jobs/JobRow.tsx) (Active + History lists) |

## Data shapes (TypeScript)

Defined in [`src/shared/usage.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/shared/usage.ts):

- **`JobUsageSummary`** — persisted on each job: `pricing_revision`, LLM `input_tokens` / `output_tokens`, `llm_cost_usd_estimate`, optional transcription fields, `total_cost_usd_estimate`.
- **`UsageCallRecord`** — extends **`LlmCallUsage`** with string **`step`** (`scene_planner`, `picker_attempt_*`, `replan_picker_attempt_*`).

Client history entries extend these in [`src/client/hooks/useLocalHistory.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/client/hooks/useLocalHistory.ts): optional `usage_summary`, `usage_calls`.

## Data flow

1. **Server** writes `usage_summary` / `usage_calls` on `JobRecord` into `jobs.json` via [`src/server/jobs/usage-persist.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/server/jobs/usage-persist.ts).
2. **`GET /api/jobs`** ([`src/app/api/jobs/route.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/app/api/jobs/route.ts)) returns those fields.
3. **`useLocalHistory`** merges server rows into localStorage (max 50 entries); usage prefers server when present.
4. Active jobs still poll `/api/jobs` every ~2s — analytics sees updates without a separate endpoint.

### When usage is written

| Route | What is merged |
|-------|----------------|
| `POST /api/transcribe` | Transcription estimate only |
| `POST /api/plan` | Scene planner usage (if any) + all picker attempts for that run |
| `POST /api/replan_scene` | Extra picker attempts (`replan_picker_attempt_*`) |

## RTL / copy

- Tab label: Hebrew **אנליטיקה**.
- `AnalyticsPanel` headings mix Hebrew titles with **English** totals/breakdown (dir `ltr` on the numeric block) for stable number formatting.
- `JobRow` usage line uses `dir="ltr"` on the numeric span.

## Styling constraints (must-follow)

- **`AGENTS.md`**: do **not** invent new `className` values unless matching rules exist in [`src/app/globals.css`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/app/globals.css).
- Current implementation reuses: `tab-panel`, `catalog-bar`, `catalog-bar-left`, `catalog-title`, `catalog-progress`, `catalog-layout`, `catalog-main`, `jobs-list`, `job-row`, `job-preview`, `job-meta`, `jobs-empty`, `duration`, `loading`.
- **`AnalyticsPanel`** uses temporary **`style={{ ... }}` inline** props for spacing/typography — replace with proper CSS when you add rules to `globals.css`.

## Empty / edge states

- No jobs with `usage_summary`: Analytics shows the `jobs-empty` Hebrew message.
- Failed jobs may still have partial usage (e.g. transcribe only).
- Re-running **Plan** appends new LLM rows (intentional “double spend” visibility).

## Non-goals for the styling agent

- Do not change **pricing math** or **usage capture** without coordinating server changes ([`src/server/billing/usage-cost.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/server/billing/usage-cost.ts), [`src/server/providers/llm`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/server/providers/llm)).

## Server reference (for bugs, not layout)

- Rate table + `PRICING_REVISION`: [`src/server/billing/usage-cost.ts`](/Users/barmoshe/claude-creative-stack/weatherv1-next/src/server/billing/usage-cost.ts)
- Env overrides: `WHISPER_USD_PER_MINUTE`, `OPENAI_GPT4O_*`, `ANTHROPIC_SONNET_*`, transcription model keys (see file).
