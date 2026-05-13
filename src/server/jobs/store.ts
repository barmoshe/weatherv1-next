/**
 * JobsStore — in-memory job registry with optional JSON persistence.
 *
 * Risk A2 mitigation: save() is the primary writer for in-app mutations.
 * writeJobsJsonFromHydration() is used only when replacing disk from R2 (no R2 mirror).
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";
import { putR2Text, r2Configured, tenantKey } from "@/server/sync/r2/client";
import { planBundlePath } from "./plan-bundle";

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

function getJobsPath(): string {
  return path.join(getRuntimePaths().runtimeDir, "jobs.json");
}

// In-memory store (single source of truth at runtime)
const store = new Map<string, JobRecord>();
let initialized = false;

function ensureDir(): void {
  const dir = path.dirname(getJobsPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function save(): void {
  const jobsPath = getJobsPath();
  ensureDir();
  const tmp = `${jobsPath}.tmp.${process.pid}`;
  const data = JSON.stringify(Object.fromEntries(store), null, 2);
  fs.writeFileSync(tmp, data, "utf8");
  fs.renameSync(tmp, jobsPath);

  if (r2Configured()) {
    const key = tenantKey("jobs/jobs.json");
    void putR2Text(key, data).catch((e) => console.warn("[jobs] R2 mirror failed:", e));
  }
}

function load(): void {
  if (initialized) return;
  initialized = true;
  ensureDir();
  const jobsPath = getJobsPath();
  if (!fs.existsSync(jobsPath)) return;
  try {
    const raw = JSON.parse(fs.readFileSync(jobsPath, "utf8")) as Record<string, unknown>;
    for (const [id, job] of Object.entries(raw)) {
      if (job && typeof job === "object") store.set(id, job as JobRecord);
    }
  } catch {
    // Corrupt jobs.json — start fresh
  }
}

/** Clear the in-memory map so the next accessor re-reads from disk. */
export function resetJobsStore(): void {
  store.clear();
  initialized = false;
}

/**
 * Replace `jobs.json` from an R2 snapshot without mirroring back to R2
 * (the remote object is already authoritative).
 */
export function writeJobsJsonFromHydration(canonicalJson: string): void {
  const jobsPath = getJobsPath();
  ensureDir();
  const tmp = `${jobsPath}.tmp.hydrate.${process.pid}`;
  fs.writeFileSync(tmp, canonicalJson, "utf8");
  fs.renameSync(tmp, jobsPath);
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
  save();
}

export function updateJob(jobId: string, patch: Partial<Omit<JobRecord, "job_id">>): void {
  load();
  const existing = store.get(jobId);
  if (!existing) return;
  Object.assign(existing, patch);
  save();
}

export function deleteJob(jobId: string): boolean {
  load();
  const deleted = store.delete(jobId);
  if (deleted) save();
  return deleted;
}

export function upsertJob(record: JobRecord): void {
  load();
  const existing = store.get(record.job_id);
  if (existing) {
    Object.assign(existing, record);
  } else {
    store.set(record.job_id, record);
  }
  save();
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

/** On boot: flip any lingering "processing" jobs to "failed" (crash recovery). */
export function crashRecoverySweep(): void {
  load();
  let changed = false;
  for (const job of store.values()) {
    if (job.status === "processing" || job.status === "queued") {
      job.status = "failed";
      job.error = "Server restarted while job was running";
      changed = true;
    }
  }
  if (sweepStaleDraftsWithoutPlan()) changed = true;
  if (changed) save();
}
