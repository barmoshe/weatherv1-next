/**
 * Plan bundle persistence — incremental JSON merge per job.
 *
 * Each step in the pipeline (transcribe → plan → render) merges its fields
 * into the same file so the bundle grows without overwriting prior data.
 *
 * Local file: runtime/outputs/forecast_{jobId}.plan.json
 * When R2 is configured, the full bundle is mirrored to
 * tenants/<tenant>/jobs/<jobId>/plan.json via the durable mirror queue.
 */

import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";
import { readJsonSync, updateJson, writeRawJson } from "@/server/runtime/atomic-json";
import {
  getR2Text,
  headR2Object,
  r2Configured,
  tenantKey,
} from "@/server/sync/r2/client";
import { enqueueMirror } from "@/server/sync/r2/mirror-queue";
import { PlanBundleSchema } from "./schema";

type PlanBundle = Record<string, unknown>;

const EMPTY_BUNDLE: PlanBundle = {};

function getOutputsDir(): string {
  return getRuntimePaths().outputsDir;
}

export function planBundlePath(jobId: string): string {
  return path.join(getOutputsDir(), `forecast_${jobId}.plan.json`);
}

export function readPlanBundle(jobId: string): PlanBundle {
  return readJsonSync(planBundlePath(jobId), PlanBundleSchema, EMPTY_BUNDLE) as PlanBundle;
}

/** True when local disk already has a parsed bundle for this job id. */
function localPlanBundleComplete(jobId: string): boolean {
  const bundle = readPlanBundle(jobId);
  return bundle.job_id === jobId;
}

function planRemoteKey(jobId: string): string {
  return tenantKey(`jobs/${jobId}/plan.json`);
}

function scheduleMirror(jobId: string): void {
  if (!r2Configured()) return;
  void enqueueMirror({
    kind: "plan",
    jobId,
    key: planRemoteKey(jobId),
  }).catch((e) => console.warn("[plan-bundle] enqueue mirror failed:", e));
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

  const key = planRemoteKey(jobId);
  try {
    const head = await headR2Object(key);
    if (!head) return false;

    const { text } = await getR2Text(key);
    let parsed: PlanBundle;
    try {
      parsed = PlanBundleSchema.parse(JSON.parse(text)) as PlanBundle;
    } catch (e) {
      console.warn("[plan-bundle] remote bundle failed schema validation:", jobId.slice(0, 8), e);
      return false;
    }
    if (parsed.job_id !== jobId) return false;

    fs.mkdirSync(getOutputsDir(), { recursive: true });
    await writeRawJson(planBundlePath(jobId), PlanBundleSchema, JSON.stringify(parsed, null, 2));
    return true;
  } catch (e) {
    console.warn("[plan-bundle] R2 hydrate failed:", jobId.slice(0, 8), e);
    return false;
  }
}

export async function updatePlanBundle(
  jobId: string,
  fields: Record<string, unknown>,
): Promise<PlanBundle> {
  fs.mkdirSync(getOutputsDir(), { recursive: true });
  const next = await updateJson(planBundlePath(jobId), PlanBundleSchema, EMPTY_BUNDLE, (current) => {
    const merged: PlanBundle = { ...(current as PlanBundle), ...fields };
    merged.job_id = jobId;
    return merged;
  });

  scheduleMirror(jobId);
  return next as PlanBundle;
}
