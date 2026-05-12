/**
 * JobsStore — in-memory job registry with optional JSON persistence.
 *
 * Risk A2 mitigation: save() is the ONLY writer. All mutations go through
 * update(). Direct fs.writeFile calls are forbidden in this module's callers.
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";

export type JobStatus = "draft" | "queued" | "processing" | "completed" | "failed";

export interface JobRecord {
  job_id: string;
  status: JobStatus;
  output_url?: string | null;
  error?: string | null;
  created_at?: string;
  audio_filename?: string;
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
  if (changed) save();
}
