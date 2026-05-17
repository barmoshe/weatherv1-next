# Claude practices in this repo

Conventions for AI agents (Claude Code, Claude API) working in
`weatherv1-next`. Read this once per session if you haven't recently —
it complements [`../CLAUDE.md`](../CLAUDE.md) (the loaded-on-every-turn
guide) with workflow + handoff conventions.

## Handoffs

A **handoff** is a markdown file an agent writes when work is paused
mid-flight (user leaving, context window getting full, end of long
session) so the next agent — possibly you, possibly someone else — can
pick up without re-deriving everything.

### When to write one

- The user explicitly asks for a handoff ("I'm going / write a handoff").
- A multi-phase task is mid-execution and the next session may not have
  the context (e.g. plan mode session where only some phases shipped).
- You committed + pushed code with deferred manual steps (e.g. release
  watch, secret rotation, post-deploy verification).
- A non-trivial refactor is staged but not yet committed.

Do **not** write one for routine small tasks (single-bug fix, doc edit,
trivial cleanup). Most sessions end cleanly without one.

### Where it lives

`.claude/HANDOFF-YYYY-MM-DD-<kebab-topic>.md`

- Date-prefixed so they sort chronologically in `ls`.
- Topic in kebab-case, ≤ 6 words, describes the scope (not the verb).
  Good: `r2-worker-proxy-and-unified-auth`. Bad: `fix-things`,
  `refactor`.
- Lives under `.claude/` (transient, not shipped to users). `.claude/`
  is **not** wholesale gitignored — these files are part of the repo so
  the next agent on a fresh clone finds them. Once all blocking items
  are resolved, move it to `.claude/archive/` with a `[COMPLETED]`
  prefix in the title — preserves the historical record without
  cluttering `ls .claude/` for the next session.

### What it must contain

Use these section headers in roughly this order — skip any that don't
apply, don't pad:

1. **Date / owner / plan file** — pointer to the source-of-truth plan
   in `~/.claude/plans/` if there is one.
2. **What we did this session** — bulleted, with commit hashes. Use
   imperative past tense ("Added /v1/objects routes", not "I added…").
3. **Current state when I stopped** — what's pushed, what's in flight
   (CI runs, deployed pieces, local-only changes).
4. **Next steps** — split into "Immediately" (the very next things) and
   "Then" (deferred / nice-to-have). Each step is a runnable command or
   a specific file:line pointer, never a vague "fix the bug".
5. **Key files modified** — table: file path | what changed. Skip if
   <3 files.
6. **Tests + checks status** — what passed locally, what hasn't been
   run.
7. **Important context the user said** — verbatim or paraphrased
   directives that aren't obvious from the code. Especially preferences
   that future you might violate.
8. **Don't do** — gotchas that would undo the session's work. Mention
   the safety rules from CLAUDE.md that are load-bearing for this
   change.

Cap at ~250 lines. If you need more, you're packing too much — split
into the plan file (under `~/.claude/plans/`) + a thin handoff that
points at it.

### What it must NOT contain

- Secrets, API tokens, decrypted Pulumi config, passwords.
- Step-by-step "Claude was helpful" narrative — write for the next
  agent who only cares about state and next actions.
- Speculation about future features the user didn't ask for.

## Session bootstrapping

For non-trivial work, before touching code:

1. Read [`../CLAUDE.md`](../CLAUDE.md) (auto-loaded), then check
   [`DOCS_INDEX.md`](DOCS_INDEX.md) for the per-topic doc router.
2. If a handoff exists matching the topic, read it first.
3. If a plan in `~/.claude/plans/` exists for this work, read it.
4. For substantial multi-step work, invoke `/weatherv1-goal`.

## Commit discipline

From CLAUDE.md, but worth re-stating because it's the most-violated
rule:

- **Never auto-commit.** Draft the message, surface it to the user, let
  them invoke. The safety classifier will block release-shaped commits
  and pushes that look like they're trying to ship without explicit
  approval.
- One logical change per commit. Don't mix the staged refactor with an
  unrelated cleanup you noticed while typing.
- Release commits bump `package.json` + `package-lock.json` together
  and push branch + tag in the same `git push` invocation (see
  [`RELEASE_CONVENTION.md`](RELEASE_CONVENTION.md)).
- Doc-only → `docs(scope): subject`. Pure refactor → `refactor(scope):`.

## Plan mode

For changes touching > 2 files or any infra (CF / Pulumi / wrangler /
release):

1. Enter plan mode. Use Explore subagents (parallel, ≤ 3) for
   research.
2. Write the plan to the path the tool gives you; never edit anything
   else in plan mode.
3. Use `AskUserQuestion` for clarifications, never to ask "is this plan
   ok?" — `ExitPlanMode` does that.
4. The plan is the durable artifact. Handoffs reference it; don't
   duplicate.

## Verification before claiming done

- Server/runtime changes → `npx tsc --noEmit` + `npm test`.
- Next route or build behavior → also `npm run build`.
- Electron startup/package changes → also `npm run standalone:prep`
  and, when feasible, `npm run electron:build`.
- Worker changes → `wrangler deploy --dry-run --cwd infra/cloudflare`
  (use `npx wrangler@3` for Node 20).
- UI changes — load in the preview, snapshot it. The dev server is
  managed by `preview_*` tools when available; never ask the user to
  check manually.

Tests passing ≠ feature working. If you can't observe the behavior
end-to-end, say so explicitly in the response.

## Memory

Use the per-session memory system at
`/Users/<you>/.claude/projects/.../memory/` to persist:

- Durable user/role/preference facts.
- Feedback the user gave that should affect future sessions.
- Cross-conversation project context (active goals, decisions made).

Do **not** persist: code patterns, file paths, anything derivable by
reading the repo. Those belong in CLAUDE.md, not memory.

## Child repos

`weatherv1-next` lives inside the larger
[`claude-creative-stack`](../../CLAUDE.md) host repo. It has its own
`.git`. Don't mix histories:

- `cd` into `weatherv1-next` before any `git` command that affects it.
- Never `git add` files from the host root that belong to the child.
- Don't promote a child to a submodule unless asked.

## Avoid

- `--no-verify` / `--no-gpg-sign` on commits.
- `git push --force` to `main` (the classifier blocks; if a force is
  truly needed, ask the user).
- Touching `.next/`, `runtime/`, or `out/` in commits — those are
  generated.
- Adding code comments that explain *what* the code does
  (well-named identifiers already do that). Only comment the *why* —
  hidden constraints, invariants, workarounds.
- Adding a feature flag, fallback, or "future-proofing" abstraction
  the user didn't ask for.
- Creating documentation files unless explicitly asked. (This file
  was asked for; usually they aren't.)
