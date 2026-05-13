import type { JobUsageSummary, LlmCallUsage, UsageCallRecord } from "@/shared/usage";
import {
  estimateLlmCostUsd,
  estimateTranscriptionCostUsd,
  PRICING_REVISION,
} from "@/server/billing/usage-cost";
import { getJob, updateJob } from "@/server/jobs/store";

function recomputeSummary(
  calls: UsageCallRecord[],
  transcription?: { billed_audio_sec: number; model: string },
): JobUsageSummary {
  let input_tokens = 0;
  let output_tokens = 0;
  let llm_cost_usd_estimate = 0;
  for (const c of calls) {
    input_tokens += c.input_tokens;
    output_tokens += c.output_tokens;
    llm_cost_usd_estimate += estimateLlmCostUsd(c);
  }

  let transcription_cost_usd_estimate: number | undefined;
  if (transcription && transcription.billed_audio_sec > 0 && transcription.model) {
    transcription_cost_usd_estimate = estimateTranscriptionCostUsd(
      transcription.billed_audio_sec,
      transcription.model,
    );
  }

  const transCost = transcription_cost_usd_estimate ?? 0;
  return {
    pricing_revision: PRICING_REVISION,
    input_tokens,
    output_tokens,
    llm_cost_usd_estimate,
    transcription_billed_audio_sec: transcription?.billed_audio_sec,
    transcription_model: transcription?.model,
    transcription_cost_usd_estimate,
    total_cost_usd_estimate: llm_cost_usd_estimate + transCost,
  };
}

function transcriptionFromJob(job: { usage_summary?: unknown } | undefined): {
  billed_audio_sec: number;
  model: string;
} | undefined {
  const s = job?.usage_summary as JobUsageSummary | undefined;
  if (
    !s ||
    typeof s.transcription_billed_audio_sec !== "number" ||
    !s.transcription_model?.trim()
  ) {
    return undefined;
  }
  return { billed_audio_sec: s.transcription_billed_audio_sec, model: s.transcription_model.trim() };
}

/** After transcribe: Whisper line item only (no LLM calls yet). */
export function persistTranscriptionUsageEstimate(
  jobId: string,
  args: { billed_audio_sec: number; transcription_model: string },
): void {
  const job = getJob(jobId);
  const calls = ((job?.usage_calls as UsageCallRecord[] | undefined) ?? []).slice();
  const summary = recomputeSummary(calls, {
    billed_audio_sec: args.billed_audio_sec,
    model: args.transcription_model,
  });
  updateJob(jobId, { usage_summary: summary });
}

/** Append scene planner + picker LLM calls; preserve transcription fields from job. */
export function persistPlanUsage(
  jobId: string,
  scenePlanner: LlmCallUsage | undefined,
  pickerUsages: UsageCallRecord[],
): void {
  const job = getJob(jobId);
  if (!job) return;

  const existing = ((job.usage_calls as UsageCallRecord[] | undefined) ?? []).slice();
  const next: UsageCallRecord[] = [...existing];
  if (scenePlanner) {
    next.push({ step: "scene_planner", ...scenePlanner });
  }
  next.push(...pickerUsages);

  const transcriptionArg = transcriptionFromJob(job);
  const summary = recomputeSummary(next, transcriptionArg);
  updateJob(jobId, { usage_calls: next, usage_summary: summary });
}

/** Append picker-only calls (replan scene flow). */
export function persistReplanPickerUsage(jobId: string, pickerUsages: UsageCallRecord[]): void {
  const job = getJob(jobId);
  if (!job) return;

  const existing = ((job.usage_calls as UsageCallRecord[] | undefined) ?? []).slice();
  const next = [...existing, ...pickerUsages];
  const transcriptionArg = transcriptionFromJob(job);
  const summary = recomputeSummary(next, transcriptionArg);
  updateJob(jobId, { usage_calls: next, usage_summary: summary });
}
