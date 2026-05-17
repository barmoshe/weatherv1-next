/**
 * Durable R2 mirror queue.
 *
 * Replaces the previous fire-and-forget `void putR2Text(...).catch(log)` pattern
 * with a persisted op-log inside `r2-sync-state.json`. Local writes enqueue an
 * op describing what to mirror; a single background drainer reads the latest
 * payload off disk and pushes it to R2 with exponential backoff. Ops survive
 * process restarts (the boot path calls `kickMirrorQueue()` once).
 *
 * Multiple enqueues for the same key coalesce — we only ever want to push the
 * latest snapshot of each file, not every intermediate write.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { getRuntimePaths } from "@/server/runtime/paths";
import { readPlanBundle } from "@/server/jobs/plan-bundle";
import { putR2Text, r2Configured } from "./client";
import { patchR2SyncState, readR2SyncState, type MirrorOp } from "./state";

/** Backoff schedule (ms). Index is min(attempts, MAX_INDEX). */
const BACKOFF_MS = [
  30_000,
  2 * 60_000,
  10 * 60_000,
  30 * 60_000,
  60 * 60_000,
  2 * 60 * 60_000,
  4 * 60 * 60_000,
  8 * 60 * 60_000,
];
const MAX_ATTEMPTS = 8;
const MAX_OP_LOG = 500;

let drainTimer: ReturnType<typeof setTimeout> | null = null;
let draining = false;

export type MirrorKind = MirrorOp["kind"];

export interface EnqueueArgs {
  kind: MirrorKind;
  key: string;
  jobId?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function jitter(ms: number): number {
  // Full jitter — picks a random delay in [0, ms].
  return Math.floor(Math.random() * ms);
}

function backoffMs(attempts: number): number {
  const base = BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)]!;
  return jitter(base);
}

function jobsPath(): string {
  return path.join(getRuntimePaths().runtimeDir, "jobs.json");
}

function planPath(jobId: string): string {
  return path.join(getRuntimePaths().outputsDir, `forecast_${jobId}.plan.json`);
}

/** Read the current payload bytes from disk for a given op. */
function loadPayload(op: MirrorOp): string | null {
  if (op.kind === "jobs") {
    const p = jobsPath();
    if (!fs.existsSync(p)) return null;
    return fs.readFileSync(p, "utf8");
  }
  if (op.kind === "plan" && op.jobId) {
    if (!fs.existsSync(planPath(op.jobId))) return null;
    // Use readPlanBundle so any post-write schema normalisation lands in R2 too.
    const bundle = readPlanBundle(op.jobId);
    if (!bundle.job_id) return null;
    return JSON.stringify(bundle, null, 2);
  }
  return null;
}

/**
 * Enqueue a mirror op. Coalesces with any other pending (non-dead) op for the
 * same key. Resets `attempts` so a fresh write gets a fresh retry budget.
 */
export async function enqueueMirror(args: EnqueueArgs): Promise<void> {
  if (!r2Configured()) return;
  await patchR2SyncState((state) => {
    const mirrors = state.mirrors ?? [];
    const filtered = mirrors.filter((m) => !(m.key === args.key && !m.dead));
    const op: MirrorOp = {
      id: randomUUID(),
      kind: args.kind,
      jobId: args.jobId,
      key: args.key,
      enqueuedAt: nowIso(),
      attempts: 0,
    };
    filtered.push(op);
    if (filtered.length > MAX_OP_LOG) {
      // Drop oldest with a warning so we never let the state file balloon.
      const dropped = filtered.length - MAX_OP_LOG;
      console.warn(`[mirror-queue] op log full, dropping ${dropped} oldest entries`);
      filtered.splice(0, dropped);
    }
    return { ...state, mirrors: filtered };
  });
  scheduleDrain(0);
}

function scheduleDrain(delay: number): void {
  if (drainTimer) clearTimeout(drainTimer);
  drainTimer = setTimeout(() => {
    drainTimer = null;
    void drain();
  }, Math.max(0, delay));
}

function pickNextDueOp(mirrors: MirrorOp[], nowMs: number): { op: MirrorOp; soonestMs: number } | null {
  let due: MirrorOp | undefined;
  let soonestMs = Infinity;
  for (const m of mirrors) {
    if (m.dead) continue;
    const ready = !m.nextAttemptAt || Date.parse(m.nextAttemptAt) <= nowMs;
    if (ready) {
      due = m;
      break;
    }
    const t = Date.parse(m.nextAttemptAt!);
    if (Number.isFinite(t) && t < soonestMs) soonestMs = t;
  }
  if (due) return { op: due, soonestMs: 0 };
  if (soonestMs === Infinity) return null;
  return { op: null as unknown as MirrorOp, soonestMs };
}

async function removeOp(id: string): Promise<void> {
  await patchR2SyncState((state) => ({
    ...state,
    mirrors: (state.mirrors ?? []).filter((m) => m.id !== id),
  }));
}

async function recordSuccess(id: string): Promise<void> {
  await patchR2SyncState((state) => ({
    ...state,
    mirrors: (state.mirrors ?? []).filter((m) => m.id !== id),
    lastMirrorError: undefined,
  }));
}

async function recordFailure(id: string, message: string): Promise<void> {
  await patchR2SyncState((state) => {
    const mirrors = (state.mirrors ?? []).map((m) => {
      if (m.id !== id) return m;
      const attempts = m.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        return { ...m, attempts, lastError: message, dead: true };
      }
      const nextAttemptAt = new Date(Date.now() + backoffMs(attempts)).toISOString();
      return { ...m, attempts, lastError: message, nextAttemptAt };
    });
    return { ...state, mirrors, lastMirrorError: message };
  });
}

async function drain(): Promise<void> {
  if (draining) return;
  if (!r2Configured()) return;
  draining = true;
  try {
    // Re-read state on every iteration so external mutations (new enqueues,
    // manual reset) are picked up.
    while (true) {
      const state = readR2SyncState();
      const mirrors = state.mirrors ?? [];
      if (mirrors.length === 0) return;
      const pick = pickNextDueOp(mirrors, Date.now());
      if (!pick) return;
      if (pick.op === null) {
        // Nothing ready right now — sleep until the soonest scheduled op.
        const delay = pick.soonestMs - Date.now();
        scheduleDrain(delay);
        return;
      }
      const op = pick.op;
      const payload = loadPayload(op);
      if (payload === null) {
        // Source file disappeared — drop the op rather than retry forever.
        await removeOp(op.id);
        continue;
      }
      try {
        await putR2Text(op.key, payload);
        await recordSuccess(op.id);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[mirror-queue] mirror failed (${op.kind} ${op.key}):`, message);
        await recordFailure(op.id, message);
        // Move on to the next due op; this one is rescheduled.
      }
    }
  } finally {
    draining = false;
  }
}

/**
 * Boot-time hook: drains any ops that were left in the queue when the previous
 * process exited. Safe to call multiple times — `draining` and `drainTimer`
 * de-dupe.
 */
export function kickMirrorQueue(): void {
  if (!r2Configured()) return;
  scheduleDrain(0);
}

/**
 * Move any dead-letter ops back to pending so the next drain retries them.
 * Returns the number of revived ops.
 */
export async function reviveDeadMirrorOps(): Promise<number> {
  let revived = 0;
  await patchR2SyncState((state) => {
    const mirrors = (state.mirrors ?? []).map((m) => {
      if (!m.dead) return m;
      revived += 1;
      return { ...m, dead: false, attempts: 0, lastError: undefined, nextAttemptAt: undefined };
    });
    return { ...state, mirrors, lastMirrorError: undefined };
  });
  if (revived > 0) scheduleDrain(0);
  return revived;
}

export interface MirrorQueueCounts {
  pending: number;
  dead: number;
  lastError?: string;
}

export function getMirrorQueueCounts(): MirrorQueueCounts {
  const state = readR2SyncState();
  const mirrors = state.mirrors ?? [];
  let pending = 0;
  let dead = 0;
  for (const m of mirrors) {
    if (m.dead) dead += 1;
    else pending += 1;
  }
  return { pending, dead, lastError: state.lastMirrorError };
}

/** Test-only — flush internal timers + re-arm state. */
export function _resetMirrorQueueForTests(): void {
  if (drainTimer) {
    clearTimeout(drainTimer);
    drainTimer = null;
  }
  draining = false;
}

/** Test-only — synchronously drain the queue (single pass). */
export async function _drainOnceForTests(): Promise<void> {
  await drain();
}
