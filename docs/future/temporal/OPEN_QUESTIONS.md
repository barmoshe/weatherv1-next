# Open Questions

Decisions left unresolved at the end of the brainstorm. Listed in rough order of "must answer before writing code" → "can defer."

## Q1 — Workflow shape: Option X (per-action) or Option Y (long-lived session)?

**State at end of brainstorm:** the user tentatively chose Option Y for its elegance, then was flagged that Option Y revives the desktop versioning problem ([`VERSIONING.md`](VERSIONING.md)) and said "not sure."

**Implications of the choice:**

- **X** → simpler workflows, simpler versioning (cancel-on-shutdown works), simpler UI (U1 or U3 fit). Loses the "job is one observable thing" feel; replan-a-scene is its own workflow rather than a signal.
- **Y** → richer model that matches how users actually work (session, edits, eventual render). Forces U2 UI shape; forces `patched()` discipline on desktop forever; rebuilds `runtime/jobs.json` as a denormalized view.

**Suggested resolution:** revisit only when Phase 2 starts. Phase 1 (R2 mirror) doesn't need this decision. By the time we're scoping Phase 2, we'll have lived with Temporal for the R2 mirror work and have a much better intuition for which shape to pick.

## Q2 — Idempotency: cache lives where? Eviction policy?

**State at end of brainstorm:** the user saw the 9-rule convention in [`IDEMPOTENCY.md`](IDEMPOTENCY.md) and said "not sure" — specifically flagged worries about plan-bundle bloat, concurrent activity writes, and whether Temporal's own activity dedup might be enough.

**Candidate answers:**

- **Cache in the plan bundle** (simplest, matches today's pattern). Bundle grows. Mitigate with TTL eviction or schema-versioned eviction on bundle load.
- **Sibling cache file** (`forecast_<jobId>.cache.json`) — same disk, but not mirrored to R2. Keeps R2 sync payloads small.
- **Separate KV store** (e.g. SQLite) — overengineered for now.
- **Rely on Temporal's own activity dedup** — the docs are clear this is *not* a substitute for app-level idempotency (Temporal dedups at-most-once-style only within a workflow's heartbeat window). So this isn't actually an option. But worth confirming.

**Suggested resolution:** decide as part of Phase 2 scoping. Phase 1 (R2 mirror) doesn't need this either — its activity is intrinsically idempotent.

## Q3 — Does embedded-Temporal-in-Electron actually work?

**State:** [`EMBEDDED_ELECTRON.md`](EMBEDDED_ELECTRON.md) says "yes, technically feasible" based on docs research. Has not been validated empirically.

**Suggested resolution:** before Phase 3 starts, run the three spikes listed in `EMBEDDED_ELECTRON.md` ("Suggested validation steps"). Each is ~1 day. Total ~3 days to know whether Phase 3 is realistic or whether desktop has to live with a different orchestration model (e.g., keep today's in-memory queue forever on desktop, Temporal only for web).

## Q4 — Cloud vs self-hosted Temporal for production web

**State:** [`R2_MIRROR_PHASE1.md`](R2_MIRROR_PHASE1.md) defaults to Temporal Cloud free tier. The user said earlier "I prefer locally and cloud option to remain open."

**Tradeoffs:**

- **Cloud (free tier)** — zero ops, ~5K mirror ops/month free, $25/M after. Outbound network dependency from web server.
- **Cloud (paid)** — same shape, no cap. Probably what we'd end up on at any real scale.
- **Self-hosted on a small VM** — full control, $10/month for Postgres + container. Real ops burden (backups, upgrades, monitoring).
- **Self-hosted as a CF Worker / serverless thing** — not supported; Temporal Server needs a real persistent process.

**Suggested resolution:** Cloud free tier for Phase 1. Revisit after we know real action volume.

## Q5 — Does Anthropic support an idempotency header in 2026?

**State:** unknown. The brainstorm noted OpenAI supports `Idempotency-Key`. Anthropic's story has been evolving — was unsupported for a long time, then partial. Convention in [`IDEMPOTENCY.md`](IDEMPOTENCY.md) hand-waves this.

**Suggested resolution:** check before Phase 2. If unsupported, document the risk that an Anthropic call that succeeded server-side but failed to return the response will be re-billed on retry. Estimate the cost (probably <1% of LLM spend in practice) and accept it.

## Q6 — Cloud render pool — keep as future option or fully drop?

**State:** [`ARCHITECTURE.md`](ARCHITECTURE.md) drops it from Phase 1–3 but reserves it as a future option for "if a hosted multi-tenant web product ships." The user's answer to the recommit question was "Mostly yes [drop cloud render], but keep it as a future option."

**Concrete meaning of "future option":**

- Activities for render are written with a `weatherv1-render` task queue.
- The cloud worker pool just isn't built yet.
- Adding it later requires: implementing `ensureLocalClips` for the R2-pull case (already designed in [`PIPELINE_MAPPING.md`](PIPELINE_MAPPING.md)), running workers somewhere, deciding what to do with the rendered MP4 (the `outputs/` R2 ban discussion).

No further resolution needed unless/until that hosted product spec exists.

## Q7 — `outputs/` R2 ban — keep or scope-limit?

**State:** brainstorm recommendation was "keep, with one narrow exception" — a `scratch/renders/` prefix with 24h TTL for hosted-web download URLs. Not relevant in Phase 1–3.

**Suggested resolution:** revisit when (if) hosted-web multi-tenant launches. Until then, the ban stays as-is.

## Q8 — UI shape commitment

**State:** user committed to U3 (hybrid). See [`UI_INTEGRATION.md`](UI_INTEGRATION.md).

**Caveat:** if Q1 lands on Option Y, U3 isn't enough — we'd need U2. So Q1 and Q8 are coupled. The U3 commitment is conditional on Option X being adopted.

## Q9 — Multi-tab collaboration semantics

**State:** noted but not discussed. With Option Y + U2, two browser tabs on the same job could both send signals. Whose wins?

**Suggested resolution:** non-issue until Option Y ships AND multi-device usage is real. Leave as a known unknown.

## Q10 — Telemetry for "oldest app version in the wild"

**State:** [`VERSIONING.md`](VERSIONING.md) calls this out — we can't deprecate old `patched()` branches without knowing nobody is still running a really old desktop version. Today we have no such telemetry.

**Suggested resolution:** if Phase 3 ships with Option Y, add a "last-seen app version" heartbeat to a usage endpoint (probably via the existing R2 sync or a tiny analytics endpoint). Don't ship Phase 3 with Option Y until this exists.

---

## How to resolve these

Most of these don't need answers right now. Phase 1 (R2 mirror) only needs Q4 answered (Cloud free tier, default). Phase 2 needs Q1, Q2, Q5, Q8 answered. Phase 3 needs Q3 validated and Q10 in place.

When resolving, edit this doc and link the resolution back into the relevant sibling doc.
