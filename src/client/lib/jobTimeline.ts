import type { JobUsageSummary, UsageCallRecord } from "@/shared/usage";
import { STEP_LABELS_HE } from "./step-labels";

export type TimelineStepKind =
  | "transcribe"
  | "scene_planner"
  | "picker"
  | "render";

export interface TimelineStep {
  kind: TimelineStepKind;
  label: string;
  /** Aggregated input tokens across calls in this step. */
  input_tokens?: number;
  /** Aggregated output tokens across calls in this step. */
  output_tokens?: number;
  /** Aggregated cost in USD (estimate). */
  cost_usd?: number;
  /** For picker / replan: how many LLM attempts were rolled into this step. */
  attempts?: number;
  /** Audio seconds billed (transcribe only). */
  billed_audio_sec?: number;
  /** True if this step matches the job's failed_step. */
  failed?: boolean;
}

const PICKER_PREFIXES = ["picker_attempt", "replan_picker"];

function isPickerStep(step: string): boolean {
  return PICKER_PREFIXES.some((p) => step.startsWith(p));
}

interface BuildOpts {
  usage_calls?: UsageCallRecord[];
  usage_summary?: JobUsageSummary;
  failed_step?: string | null;
  status?: string;
}

/**
 * Derive an ordered list of pipeline steps from the job's persisted usage data.
 * Each step is either present (with usage rolled up) or skipped — we never
 * fabricate steps that didn't run, so the timeline doubles as a "how far did
 * we get" indicator.
 */
export function buildJobTimeline(opts: BuildOpts): TimelineStep[] {
  const calls = opts.usage_calls ?? [];
  const summary = opts.usage_summary;
  const failed = opts.failed_step ?? null;
  const steps: TimelineStep[] = [];

  // Transcribe — derived from usage_summary, since Whisper isn't tracked as a
  // UsageCallRecord (no LLM token counts).
  if (summary?.transcription_billed_audio_sec && summary.transcription_billed_audio_sec > 0) {
    steps.push({
      kind: "transcribe",
      label: STEP_LABELS_HE.transcribe,
      billed_audio_sec: summary.transcription_billed_audio_sec,
      cost_usd: summary.transcription_cost_usd_estimate,
      failed: failed === "transcribe",
    });
  }

  // Scene planner — a single UsageCallRecord with step === "scene_planner".
  const scenePlannerCall = calls.find((c) => c.step === "scene_planner");
  if (scenePlannerCall) {
    steps.push({
      kind: "scene_planner",
      label: STEP_LABELS_HE.scene_planner,
      input_tokens: scenePlannerCall.input_tokens,
      output_tokens: scenePlannerCall.output_tokens,
      failed: failed === "scene_planner",
    });
  } else if (failed === "scene_planner") {
    steps.push({
      kind: "scene_planner",
      label: STEP_LABELS_HE.scene_planner,
      failed: true,
    });
  }

  // Picker — group every picker_attempt_* and replan_picker_* into a single row.
  const pickerCalls = calls.filter((c) => isPickerStep(c.step));
  if (pickerCalls.length > 0) {
    const totals = pickerCalls.reduce(
      (acc, c) => {
        acc.input += c.input_tokens;
        acc.output += c.output_tokens;
        return acc;
      },
      { input: 0, output: 0 },
    );
    steps.push({
      kind: "picker",
      label: STEP_LABELS_HE.picker,
      input_tokens: totals.input,
      output_tokens: totals.output,
      attempts: pickerCalls.length,
      failed: failed === "picker",
    });
  } else if (failed === "picker") {
    steps.push({
      kind: "picker",
      label: STEP_LABELS_HE.picker,
      attempts: 0,
      failed: true,
    });
  }

  // Render — there's no usage record, but if the job reached a render
  // outcome (success, failure, or actively rendering) we should show it.
  const reachedRender = failed === "render" || opts.status === "completed" || opts.status === "processing";
  if (reachedRender) {
    steps.push({
      kind: "render",
      label: STEP_LABELS_HE.render,
      failed: failed === "render",
    });
  }

  return steps;
}

/** Format a USD cost — three decimals while sub-dollar, two otherwise. */
export function formatCostUsd(usd: number | undefined): string | undefined {
  if (typeof usd !== "number" || !Number.isFinite(usd) || usd <= 0) return undefined;
  return usd < 1 ? `$${usd.toFixed(3)}` : `$${usd.toFixed(2)}`;
}
