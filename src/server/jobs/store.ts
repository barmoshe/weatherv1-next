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
import { getRuntimePaths } from "@/server/runtime/paths";
import { readJsonSync, updateJson, writeRawJson } from "@/server/runtime/atomic-json";
import { r2Configured, tenantKey } from "@/server/sync/r2/client";
import { enqueueMirror } from "@/server/sync/r2/mirror-queue";
import { planBundlePath } from "./plan-bundle";
import { JobsFileSchema } from "./schema";

/** Drop old drafts that never got a plan bundle (phantom seeds / abandoned). */
const DRAFT_WITHOUT_PLAN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export type JobStatus = "draft" | "queued" | "processing" | "completed" | "failed";

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  output_url?: string | null;
  error?: string | null;
  created_at?: string;
  audio_filename?: string;
  /** LLM + transcription usage rollup (see `@/shared/usage` JobUsageSummary). */
  usage_summary?: import("@/shared/usage").JobUsageSummary;
  /** Per-call LLM usage for analytics (steps like scene_planner, picker_attempt_1). */
  usage_calls?: import("@/shared/usage").UsageCallRecord[];
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
async function mutateAndPersist(
  mutate: (current: JobsFile) => JobsFile | void,
): Promise<void> {
  load();
  const next = await updateJson(getJobsPath(), JobsFileSchema, EMPTY_FILE, (current) => {
    // Start from the latest disk contents so we don't clobber concurrent writers.
    const draft: JobsFile = { ...(current as JobsFile) };
    const result = mutate(draft);
    return (result ?? draft) as JobsFile;
  });
  applyDiskToStore(next as JobsFile);
  scheduleMirror();
}

function mutateAndPersistSync(mutate: (current: JobsFile) => JobsFile | void): void {
  // Synchronous-call shim for the few callers that historically didn't await
  // (`updateJob`/`crashRecoverySweep`). We fire the lock-protected write but
  // don't block — the in-memory store still reflects the change immediately
  // (these callers mutate the live record before invoking save), and the
  // disk write is consistent because everyone goes through `updateJson`.
  void mutateAndPersist(mutate).catch((e) => console.warn("[jobs] persist failed:", e));
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

export function updateJob(jobId: string, patch: Partial<Omit<JobRecord, "job_id">>): void {
  load();
  const existing = store.get(jobId);
  if (!existing) return;
  Object.assign(existing, patch);
  mutateAndPersistSync((current) => {
    const target = current[jobId] ?? { ...existing };
    Object.assign(target, patch);
    current[jobId] = target;
  });
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

/**
 * On boot: flip any "processing" jobs to "failed" (crash recovery).
 *
 * Queued jobs are intentionally left alone — `worker.startWorker()` re-enqueues
 * them on the next drain loop. Flipping them to "failed" here would silently
 * drop user work on every restart.
 */
export function crashRecoverySweep(): void {
  load();
  let changed = false;
  for (const job of store.values()) {
    if (job.status === "processing") {
      job.status = "failed";
      job.error = "Server restarted while job was running";
      changed = true;
    }
  }
  if (sweepStaleDraftsWithoutPlan()) changed = true;
  if (changed) {
    const fresh = snapshot();
    mutateAndPersistSync(() => fresh);
  }
}
