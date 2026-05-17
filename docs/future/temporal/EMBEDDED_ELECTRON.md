# Embedded Temporal in Electron — Research

## Question

Can a Temporal cluster realistically be bundled inside the WeatherV1 Electron desktop app, such that workflows run locally and offline, with no dependency on a remote Temporal Cloud cluster?

## Short answer

**Yes, technically feasible — closer to "supported" than "weird hack" — but with caveats.** The Temporal CLI now ships an embedded Temporal Service (server + SQLite persistence + Web UI) explicitly designed for development and CI/CD. The same binary is what `temporal server start-dev` runs. Using it for a single-user desktop app is off the official "production" guidance (which assumes Postgres/Cassandra), but it's the closest match to WeatherV1's deployment shape.

## Sources

- [Temporal CLI command reference](https://docs.temporal.io/cli) — describes the embedded Temporal Service mode with SQLite persistence and Web UI bundled in.
- [Temporalite blog post](https://temporal.io/blog/temporalite-the-foundation-of-the-new-temporal-cli-experience) — origin story of the embedded server, which calls out "running an embedded Temporal server instance" as an explicit use case the team built for.

## Architecture sketch

```
┌─────────────────── Electron app ────────────────────┐
│                                                     │
│  Main process (Node)                                │
│    │                                                │
│    ├─ spawns: temporal server start-dev             │
│    │            --db-filename <userData>/temp.db    │
│    │            --port <chosen loopback port>       │
│    │                                                │
│    └─ spawns: Next standalone child                 │
│                 (the existing Electron-managed      │
│                  server on 127.0.0.1:3765)          │
│                  │                                  │
│                  └─ Temporal worker process or      │
│                     in-process worker, connects to  │
│                     127.0.0.1:<temporal-port>       │
│                                                     │
│  Renderer (BrowserWindow)                           │
│    │ HTTP to 127.0.0.1:3765 (existing pattern)      │
│    │ Optional: link to 127.0.0.1:<ui-port>/         │
│    │           for the Temporal Web UI              │
│                                                     │
│  Bundled binaries in resources/                     │
│    ├─ ffmpeg, ffprobe  (already there)              │
│    └─ temporal         (new — ~50–80 MB per OS)     │
│                                                     │
└─────────────────────────────────────────────────────┘
```

## What's good about this shape

- **Mirrors the existing ffmpeg-static pattern.** `temporal` joins `ffmpeg-static` and `ffprobe-static` as a per-OS native binary in `resources/`. Same release pipeline, same code-signing flow.
- **Loopback-only.** No exposure outside the user's machine. Aligns with the existing `127.0.0.1` invariant from CLAUDE.md ("Do not substitute `localhost` for `127.0.0.1`").
- **Free observability.** Users (and us, when debugging support tickets) get the Temporal Web UI on a local port — a much better debug surface than today's "grep `runtime/jobs.json`."
- **SQLite persistence survives app restarts.** The `--db-filename` flag persists to disk, so a session workflow paused overnight resumes on next launch.
- **No cloud dependency.** Offline-by-default, matches WeatherV1's local-first philosophy.

## Risks and unknowns

### Binary size
The `temporal` CLI binary is ~50–80 MB depending on platform. Adds noticeably to installer size (current Windows installer is ~120 MB). Not a dealbreaker but a real cost.

### Code signing
On macOS, the binary must be either part of the app bundle's signature or have its own developer signature, or Gatekeeper will quarantine it. Windows SmartScreen has similar concerns. The existing ffmpeg binaries already need this treatment — Temporal joins them.

### SQLite is "dev/CI" persistence officially
Temporal's production guidance assumes Postgres or Cassandra. SQLite is documented as suitable for "development and CI/CD." For a single-user laptop app this is almost certainly fine — single-writer, modest throughput, file-level durability — but you're slightly off the supported path. Worth a spike before committing.

### Version skew between bundled binary and SDK
The Temporal Node SDK has version compatibility expectations vs. the server. When upgrading the bundled `temporal` binary in an app release, the SDK side needs to bump in lockstep. Same upgrade hazard as bumping ffmpeg-static.

### Startup time
Cold start of `temporal server start-dev` is ~1–3 seconds on a modern laptop. The Next standalone child already takes ~2–4 seconds. Sequential startup is ~5–7s before the renderer can hit `/api/*`. Parallel startup is feasible (Temporal doesn't depend on Next) but adds orchestration complexity in `electron/server-manager.cjs`.

### Database upgrades across app versions
Newer Temporal versions occasionally need schema migrations on the persistence layer. The CLI handles this automatically on startup, but if a user upgrades from v2 of WeatherV1 (bundling Temporal 1.X) to v3 (bundling Temporal 1.Y), the SQLite schema migration runs unsupervised. Worth testing the upgrade path explicitly before shipping.

### Workflow code versioning
The hard part of long-lived workflows + ad-hoc desktop upgrades. Detailed separately in [`VERSIONING.md`](VERSIONING.md). Embedded Temporal makes this **our** problem, not Temporal Cloud's.

## What we don't yet know

- **Actual disk overhead** of a sustained SQLite workload — does the db file grow without bound, or does Temporal compact it? Spike with a synthetic workload before committing.
- **Backup story** — should the SQLite file be included in any "export your data" feature WeatherV1 ships?
- **Behavior when the bundled binary crashes mid-render** — does Temporal recover, or does the workflow get stuck? Should be tested with deliberate kill-9 of the server process.
- **Whether the embedded server can co-exist with a user's own `temporal` install on `$PATH`** — port conflicts, version confusion. Solvable but needs thought.

## Suggested validation steps (if Phase 3 ever starts)

1. **Pure spike**: `npm install @temporalio/client @temporalio/worker @temporalio/workflow`, plus download the `temporal` binary manually for the current platform. Wire up one trivial workflow (e.g. a "ping" activity that returns `pong`) running against `temporal server start-dev`. Measure cold start time, observe Web UI, kill -9 the server and observe recovery on restart.
2. **Packaging spike**: add the `temporal` binary to `electron-builder` config, ensure it ends up in `resources/`, ensure macOS signing/notarization doesn't choke.
3. **Long-run spike**: leave it running for a week with synthetic load, watch the SQLite file grow, check whether anything leaks.

Only after those three should embedded-in-Electron move from "research" to "plan."

## Alternative shapes considered

- **No embedded cluster — desktop uses Temporal Cloud.** Rejected: violates offline requirement.
- **No embedded cluster — desktop keeps today's in-memory queue, only web uses Temporal.** Viable as a fallback if embedded-in-Electron turns out to be too painful. Means maintaining two execution backends (the "Shape B" option from the original brainstorm). See [`OPEN_QUESTIONS.md`](OPEN_QUESTIONS.md).
- **Run Temporal in a Docker container shipped with Electron.** Considered and rejected: requires Docker on the user's machine, which is a non-starter for non-technical users.
- **Use a different durable workflow library entirely** (e.g. inngest, restate, hatchet). Out of scope for this research, but worth a comparison if Temporal turns out to be a bad fit.
