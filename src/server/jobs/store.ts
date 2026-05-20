/**
 * JobsStore — in-memory job registry backed by `runtime/jobs.json`.
 *
 * Persistence path goes through `updateJson()` so reads and writes are
 * serialized under a `proper-lockfile` advisory lock — concurrent
 * `upsertJob`/`updateJob` calls no longer race with each other or with the
 * crash-recovery sweep. R2 mirroring is enqueued (durable, retried) rather
 * than fire-and-forget, so cloud and disk stay in sync even across outages.
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths, safeId } from "@/server/runtime/paths";
import { readJsonSync, updateJson, writeRawJson } from "@/server/runtime/atomic-json";
import { r2Configured, tenantKey } from "@/server/sync/r2/client";
import { enqueueMirror } from "@/server/sync/r2/mirror-queue";
import { planBundlePath } from "./plan-bundle";
import { JobsFileSchema } from "./schema";

/** Drop old drafts that never got a plan bundle (phantom seeds / abandoned). */
const DRAFT_WITHOUT_PLAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type JobStatus =
  | "draft"
  | "queued"
  | "processing"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  output_url?: string | null;
  error?: string | null;
  /** Stable identifier so the UI can branch (e.g. show a billing CTA). */
  error_code?: string | null;
  /** Which integration/runtime produced the error: openai, anthropic, ffmpeg, worker. */
  error_provider?: string | null;
  /** Deep link the UI can offer when the failure is fixable in a provider console. */
  error_console_url?: string | null;
  /** Pipeline step where the failure happened: transcribe, scene_planner, picker, render. */
  failed_step?: string | null;
  /** ISO timestamp of the failure — distinct from created_at. */
  failed_at?: string | null;
  created_at?: string;
  audio_filename?: string;
  /** LLM + transcription usage rollup (see `@/shared/usage` JobUsageSummary). */
  usage_summary?: import("@/shared/usage").JobUsageSummary;
  /** Per-call LLM usage for analytics (steps like scene_planner, picker_attempt_1). */
  usage_calls?: import("@/shared/usage").UsageCallRecord[];
  /** Render progress 0..1 while ffmpeg runs; nulled on terminal state. */
  progress?: number | null;
  /** Estimated seconds remaining for the active render. */
  eta_sec?: number | null;
  /** Auto-requeue counter for interrupted renders (bounded to avoid crash loops). */
  interrupt_count?: number;
}

type JobsFile = Record<string, JobRecord>;

const EMPTY_FILE: JobsFile = {};

function getJobsPath(): string {
  return path.join(getRuntimePaths().runtimeDir, "jobs.json");
}

// In-memory store (single source of truth at runtime). The disk file is the
// canonical persistent copy; the map is a hot read-through cache.
const store = new Map<string, JobRecord>();
let initialized = false;

function applyDiskToStore(records: JobsFile): void {
  store.clear();
  for (const [id, job] of Object.entries(records)) {
    store.set(id, job as JobRecord);
  }
}

function load(): void {
  if (initialized) return;
  initialized = true;
  const raw = readJsonSync(getJobsPath(), JobsFileSchema, EMPTY_FILE) as JobsFile;
  applyDiskToStore(raw);
}

function snapshot(): JobsFile {
  return Object.fromEntries(store) as JobsFile;
}

function scheduleMirror(): void {
  if (!r2Configured()) return;
  void enqueueMirror({ kind: "jobs", key: tenantKey("jobs/jobs.json") }).catch((e) =>
    console.warn("[jobs] enqueue mirror failed:", e),
  );
}

/**
 * Apply a mutation under the on-disk lock, then mirror to R2. The mutator
 * receives the current disk contents (not the in-memory snapshot) so it sees
 * any out-of-band changes from another writer that may have landed between
 * our last read and this update.
 */
interface PersistOpts {
  /** Enqueue an R2 mirror op after the write. Off for ephemeral writes
   * (render progress) — the next durable transition mirrors the real state. */
  mirror?: boolean;
}

async function mutateAndPersist(
  mutate: (current: JobsFile) => JobsFile | void,
  opts: PersistOpts = {},
): Promise<void> {
  load();
  const next = await updateJson(getJobsPath(), JobsFileSchema, EMPTY_FILE, (current) => {
    // Start from the latest disk contents so we don't clobber concurrent writers.
    const draft: JobsFile = { ...(current as JobsFile) };
    const result = mutate(draft);
    return (result ?? draft) as JobsFile;
  });
  applyDiskToStore(next as JobsFile);
  if (opts.mirror !== false) scheduleMirror();
}

// In-flight fire-and-forget writes, tracked so callers (and tests) can await
// quiescence — e.g. before tearing down a temp runtime dir, which otherwise
// races the lock-release and fails ENOTEMPTY on Windows.
const pendingPersists = new Set<Promise<unknown>>();

function mutateAndPersistSync(
  mutate: (current: JobsFile) => JobsFile | void,
  opts: PersistOpts = {},
): void {
  // Synchronous-call shim for the few callers that historically didn't await
  // (`updateJob`/`crashRecoverySweep`). We fire the lock-protected write but
  // don't block — the in-memory store still reflects the change immediately
  // (these callers mutate the live record before invoking save), and the
  // disk write is consistent because everyone goes through `updateJson`.
  const p = mutateAndPersist(mutate, opts).catch((e) => console.warn("[jobs] persist failed:", e));
  pendingPersists.add(p);
  void p.finally(() => pendingPersists.delete(p));
}

/** Resolve once every in-flight fire-and-forget persist has settled. */
export async function flushPendingPersists(): Promise<void> {
  await Promise.all([...pendingPersists]);
}

function ensureDir(): void {
  const dir = path.dirname(getJobsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

/** Clear the in-memory map so the next accessor re-reads from disk. */
export function resetJobsStore(): void {
  store.clear();
  initialized = false;
}

/**
 * Replace `jobs.json` from an R2 snapshot without mirroring back to R2
 * (the remote object is already authoritative). Uses the same atomic+lock
 * path as in-app mutations, so it is safe even with concurrent writers.
 */
export async function writeJobsJsonFromHydration(canonicalJson: string): Promise<void> {
  ensureDir();
  await writeRawJson(getJobsPath(), JobsFileSchema, canonicalJson);
  resetJobsStore();
}

export function getJob(jobId: string): JobRecord | undefined {
  load();
  return store.get(jobId);
}

export function getAllJobs(): JobRecord[] {
  load();
  return Array.from(store.values());
}

export function setJob(record: JobRecord): void {
  load();
  store.set(record.job_id, record);
  const id = record.job_id;
  mutateAndPersistSync((current) => {
    current[id] = record;
  });
}

export function updateJob(
  jobId: string,
  patch: Partial<Omit<JobRecord, "job_id">>,
  opts?: PersistOpts,
): void {
  load();
  const existing = store.get(jobId);
  if (!existing) return;
  Object.assign(existing, patch);
  mutateAndPersistSync((current) => {
    const target = current[jobId] ?? { ...existing };
    Object.assign(target, patch);
    current[jobId] = target;
  }, opts);
}

export function deleteJob(jobId: string): boolean {
  load();
  const deleted = store.delete(jobId);
  if (deleted) {
    mutateAndPersistSync((current) => {
      delete current[jobId];
    });
  }
  return deleted;
}

export function upsertJob(record: JobRecord): void {
  load();
  const existing = store.get(record.job_id);
  if (existing) Object.assign(existing, record);
  else store.set(record.job_id, record);
  mutateAndPersistSync((current) => {
    const prior = current[record.job_id];
    current[record.job_id] = prior ? { ...prior, ...record } : { ...record };
  });
}

/**
 * Like `upsertJob`, but resolves only once the change is durable on disk. Use
 * on transitions where a lost write would silently drop work — notably the
 * `draft -> queued` enqueue in `/api/render`: a 200 must guarantee the queued
 * flip survives a crash so boot re-enqueue can recover it.
 */
export async function upsertJobAwait(record: JobRecord): Promise<void> {
  load();
  const existing = store.get(record.job_id);
  if (existing) Object.assign(existing, record);
  else store.set(record.job_id, record);
  await mutateAndPersist((current) => {
    const prior = current[record.job_id];
    current[record.job_id] = prior ? { ...prior, ...record } : { ...record };
  });
}


function sweepStaleDraftsWithoutPlan(): boolean {
  let changed = false;
  const toRemove: string[] = [];
  for (const job of store.values()) {
    if (job.status !== "draft") continue;
    if (fs.existsSync(planBundlePath(job.job_id))) continue;
    const ts = job.created_at ? Date.parse(job.created_at) : NaN;
    if (!Number.isFinite(ts)) continue;
    if (Date.now() - ts < DRAFT_WITHOUT_PLAN_MAX_AGE_MS) continue;
    toRemove.push(job.job_id);
  }
  for (const id of toRemove) {
    if (store.delete(id)) changed = true;
  }
  return changed;
}

/** Don't delete an upload younger than this — it may belong to an in-flight
 * transcribe whose job record isn't written yet (see /api/transcribe). */
const ORPHAN_UPLOAD_GRACE_MS = 60 * 60 * 1000;

/**
 * Delete runtime files left behind by killed jobs: uploaded audio with no
 * owning job, and render temp dirs for jobs that are no longer active. Pure
 * filesystem cleanup — does not mutate the store.
 */
function sweepOrphanRuntimeFiles(): void {
  const { uploadsDir, renderTmpDir } = getRuntimePaths();

  // Orphan uploads: no job references the file AND it's past the grace window.
  const ownedAudio = new Set<string>();
  for (const job of store.values()) {
    if (job.audio_filename) ownedAudio.add(path.basename(job.audio_filename));
  }
  try {
    for (const name of fs.readdirSync(uploadsDir)) {
      if (ownedAudio.has(name)) continue;
      const full = path.join(uploadsDir, name);
      try {
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;
        if (Date.now() - stat.mtimeMs < ORPHAN_UPLOAD_GRACE_MS) continue;
        fs.rmSync(full, { force: true });
      } catch {
        /* ignore individual file errors */
      }
    }
  } catch {
    /* uploads dir may not exist yet */
  }

  // Render temp dirs: keep only those owned by an active (processing/queued) job.
  const activeRenderDirs = new Set<string>();
  for (const job of store.values()) {
    if (job.status === "processing" || job.status === "queued") {
      activeRenderDirs.add(safeId(job.job_id));
    }
  }
  try {
    for (const name of fs.readdirSync(renderTmpDir)) {
      if (activeRenderDirs.has(name)) continue;
      try {
        fs.rmSync(path.join(renderTmpDir, name), { recursive: true, force: true });
      } catch {
        /* ignore individual dir errors */
      }
    }
  } catch {
    /* render tmp dir may not exist yet */
  }
}

/**
 * On boot: flip any "processing" jobs to "interrupted" (crash recovery).
 *
 * "interrupted" is not a failure — `worker.startWorker()` auto-requeues these
 * (bounded by `interrupt_count`) so a render killed by an app restart resumes
 * rather than surfacing a scary red error.
 *
 * Queued jobs are intentionally left alone — `startWorker()` re-enqueues them
 * on the next drain loop. Flipping them to "failed" here would silently drop
 * user work on every restart.
 */
export function crashRecoverySweep(): void {
  load();
  let changed = false;
  for (const job of store.values()) {
    if (job.status === "processing") {
      job.status = "interrupted";
      job.progress = null;
      job.eta_sec = null;
      changed = true;
    }
  }
  if (sweepStaleDraftsWithoutPlan()) changed = true;
  if (changed) {
    const fresh = snapshot();
    mutateAndPersistSync(() => fresh);
  }
  // After the status sweep so interrupted/failed jobs free their temp dirs.
  sweepOrphanRuntimeFiles();
}
