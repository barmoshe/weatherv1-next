/**
 * Failure-recording helpers that live alongside the jobs store. Routes call
 * `recordJobFailure` to persist a structured cause; the worker uses
 * `markRenderFailed` / `markJobCompleted` to also flip status; the retry
 * route uses `clearJobFailure` to wipe the previous attempt.
 *
 * First failure in a pipeline wins (see the `failed_at` guard) — downstream
 * catches don't overwrite the root cause with a generic "render failed".
 */

import { getJob, updateJob } from "@/server/jobs/store";
import type { MappedErrorResponse } from "@/server/providers/errors";

export function recordJobFailure(
  jobId: string,
  step: string,
  err: unknown,
  mapped?: MappedErrorResponse | null,
): void {
  if (!jobId) return;
  const existing = getJob(jobId);
  if (!existing) return;
  if (existing.failed_at) return;
  const body = mapped?.body;
  const fallback = err instanceof Error ? err.message : String(err);
  updateJob(jobId, {
    error: body?.error ?? fallback,
    error_code: body?.error_code ?? "unknown",
    error_provider: body?.provider ?? null,
    error_console_url: body?.console_url ?? null,
    failed_step: step,
    failed_at: new Date().toISOString(),
  });
}

interface PickerStatusLike {
  error_code?: string | null;
}

export function recordPickerFailure(
  jobId: string,
  pickerStatus: PickerStatusLike,
  msgHe: string,
  step: string = "picker",
): void {
  recordJobFailure(jobId, step, new Error(msgHe), {
    status: 502,
    body: {
      success: false,
      error: msgHe,
      error_code: pickerStatus.error_code ?? "picker_failed",
    },
  });
}

export function markRenderFailed(
  jobId: string,
  code: string,
  message: string,
  provider: string = "worker",
): void {
  updateJob(jobId, {
    status: "failed",
    error: message,
    error_code: code,
    error_provider: provider,
    failed_step: "render",
    failed_at: new Date().toISOString(),
  });
}

export function markJobCompleted(jobId: string, outputUrl: string): void {
  updateJob(jobId, {
    status: "completed",
    output_url: outputUrl,
    error: null,
    error_code: null,
    error_provider: null,
    error_console_url: null,
    failed_step: null,
    failed_at: null,
  });
}

export function clearJobFailure(jobId: string): void {
  updateJob(jobId, {
    error: null,
    error_code: null,
    error_provider: null,
    error_console_url: null,
    failed_step: null,
    failed_at: null,
  });
}
