/**
 * Plan bundle persistence — incremental JSON merge per job.
 *
 * Each step in the pipeline (transcribe → plan → render) merges its fields
 * into the same file so the bundle grows without overwriting prior data.
 *
 * Local file: runtime/outputs/forecast_{jobId}.plan.json
 * When R2 is configured, the full bundle is also mirrored to
 * tenants/<tenant>/jobs/<jobId>/plan.json so another machine can restore.
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";
import {
  getR2Text,
  headR2Object,
  putR2Text,
  r2Configured,
  tenantKey,
} from "@/server/sync/r2/client";

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

/** True when local disk already has a parsed bundle for this job id. */
function localPlanBundleComplete(jobId: string): boolean {
  const p = planBundlePath(jobId);
  if (!fs.existsSync(p)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Record<string, unknown>;
    return raw.job_id === jobId;
  } catch {
    return false;
  }
}

/**
 * When R2 holds `jobs/<jobId>/plan.json`, write it to the local forecast_*.plan.json
 * so restores work on a fresh machine (jobs.json alone is not enough).
 *
 * @param opts.force When true, replace local from R2 even if a complete local bundle exists (cloud wins).
 */
export async function hydratePlanBundleFromR2(jobId: string, opts?: { force?: boolean }): Promise<boolean> {
  if (!r2Configured()) return false;
  const force = Boolean(opts?.force);
  if (!force && localPlanBundleComplete(jobId)) return false;

  const key = tenantKey(`jobs/${jobId}/plan.json`);
  try {
    const head = await headR2Object(key);
    if (!head) return false;

    const { text } = await getR2Text(key);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return false;
    }
    if (parsed.job_id !== jobId) return false;

    fs.mkdirSync(getOutputsDir(), { recursive: true });
    const dest = planBundlePath(jobId);
    const tmp = `${dest}.tmp.hydrate.${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(parsed, null, 2), "utf8");
    fs.renameSync(tmp, dest);
    return true;
  } catch (e) {
    console.warn("[plan-bundle] R2 hydrate failed:", jobId.slice(0, 8), e);
    return false;
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

  if (r2Configured()) {
    const key = tenantKey(`jobs/${jobId}/plan.json`);
    const payload = JSON.stringify(bundle, null, 2);
    void putR2Text(key, payload).catch((e) => console.warn("[plan-bundle] R2 mirror failed:", e));
  }

  return bundle;
}
