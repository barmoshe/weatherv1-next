/**
 * Plan bundle persistence — incremental JSON merge per job.
 *
 * Each step in the pipeline (transcribe → plan → render) merges its fields
 * into the same file so the bundle grows without overwriting prior data.
 *
 * File: runtime/outputs/forecast_{jobId}.plan.json
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";

function getOutputsDir(): string {
  return getRuntimePaths().outputsDir;
}

export function planBundlePath(jobId: string): string {
  return path.join(getOutputsDir(), `forecast_${jobId}.plan.json`);
}

export function readPlanBundle(jobId: string): Record<string, unknown> {
  const p = planBundlePath(jobId);
  if (!fs.existsSync(p)) return {};
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function updatePlanBundle(
  jobId: string,
  fields: Record<string, unknown>,
): Record<string, unknown> {
  fs.mkdirSync(getOutputsDir(), { recursive: true });
  const bundle = readPlanBundle(jobId);
  bundle.job_id = jobId;
  Object.assign(bundle, fields);
  const tmp = `${planBundlePath(jobId)}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(bundle, null, 2), "utf8");
  fs.renameSync(tmp, planBundlePath(jobId));
  return bundle;
}
