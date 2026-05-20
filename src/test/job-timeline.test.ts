import { describe, it, expect } from "vitest";
import { buildJobTimeline, formatCostUsd } from "@/client/lib/jobTimeline";
import type { JobUsageSummary, UsageCallRecord } from "@/shared/usage";

const usageSummary: JobUsageSummary = {
  pricing_revision: "test",
  input_tokens: 100,
  output_tokens: 50,
  llm_cost_usd_estimate: 0.02,
  transcription_billed_audio_sec: 90,
  transcription_model: "whisper-1",
  transcription_cost_usd_estimate: 0.005,
  total_cost_usd_estimate: 0.025,
};

const calls: UsageCallRecord[] = [
  { step: "scene_planner", provider: "openai", model: "gpt-4o-mini", input_tokens: 60, output_tokens: 20 },
  { step: "picker_attempt_1", provider: "openai", model: "gpt-4o-mini", input_tokens: 20, output_tokens: 15 },
  { step: "picker_attempt_2", provider: "openai", model: "gpt-4o-mini", input_tokens: 20, output_tokens: 15 },
];

describe("buildJobTimeline", () => {
  it("builds transcribe + scene_planner + picker (grouped) for a completed job", () => {
    const steps = buildJobTimeline({
      usage_calls: calls,
      usage_summary: usageSummary,
      failed_step: null,
      status: "completed",
    });
    expect(steps.map((s) => s.kind)).toEqual(["transcribe", "scene_planner", "picker", "render"]);
    const picker = steps.find((s) => s.kind === "picker");
    expect(picker?.attempts).toBe(2);
    expect(picker?.input_tokens).toBe(40);
    expect(picker?.output_tokens).toBe(30);
  });

  it("marks the failed step", () => {
    const steps = buildJobTimeline({
      usage_calls: calls,
      usage_summary: usageSummary,
      failed_step: "render",
      status: "failed",
    });
    const render = steps.find((s) => s.kind === "render");
    expect(render?.failed).toBe(true);
  });

  it("shows scene_planner row even when only the failure is recorded (no usage)", () => {
    const steps = buildJobTimeline({
      usage_calls: [],
      usage_summary: { ...usageSummary, transcription_billed_audio_sec: 0 },
      failed_step: "scene_planner",
      status: "failed",
    });
    expect(steps.map((s) => s.kind)).toEqual(["scene_planner"]);
    expect(steps[0].failed).toBe(true);
  });

  it("groups replan picker attempts into the picker row", () => {
    const replanCalls: UsageCallRecord[] = [
      { step: "picker_attempt_1", provider: "openai", model: "x", input_tokens: 10, output_tokens: 5 },
      { step: "replan_picker_attempt_1", provider: "openai", model: "x", input_tokens: 10, output_tokens: 5 },
    ];
    const steps = buildJobTimeline({ usage_calls: replanCalls, status: "completed" });
    const picker = steps.find((s) => s.kind === "picker");
    expect(picker?.attempts).toBe(2);
  });
});

describe("formatCostUsd", () => {
  it("formats sub-dollar costs with three decimals", () => {
    expect(formatCostUsd(0.025)).toBe("$0.025");
  });
  it("formats dollar+ costs with two decimals", () => {
    expect(formatCostUsd(1.234)).toBe("$1.23");
  });
  it("returns undefined for zero or invalid", () => {
    expect(formatCostUsd(0)).toBeUndefined();
    expect(formatCostUsd(undefined)).toBeUndefined();
    expect(formatCostUsd(Number.NaN)).toBeUndefined();
  });
});
