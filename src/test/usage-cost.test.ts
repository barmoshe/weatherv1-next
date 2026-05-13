// @vitest-environment node
import { describe, it, expect, beforeEach, vi } from "vitest";
import { estimateLlmCostUsd, estimateTranscriptionCostUsd, PRICING_REVISION } from "@/server/billing/usage-cost";

describe("usage-cost estimates", () => {
  beforeEach(() => {
    delete process.env.WHISPER_USD_PER_MINUTE;
    delete process.env.OPENAI_GPT4O_INPUT_PER_MTOK_USD;
    delete process.env.OPENAI_GPT4O_OUTPUT_PER_MTOK_USD;
  });

  it("exports a stable pricing revision tag", () => {
    expect(PRICING_REVISION).toContain("weatherv1");
  });

  it("computes Whisper cost from seconds at default per-minute rate", () => {
    expect(estimateTranscriptionCostUsd(60, "whisper-1")).toBeCloseTo(0.006, 6);
    expect(estimateTranscriptionCostUsd(30, "whisper-1")).toBeCloseTo(0.003, 6);
  });

  it("honours WHISPER_USD_PER_MINUTE override", async () => {
    vi.resetModules();
    process.env.WHISPER_USD_PER_MINUTE = "0.012";
    const { estimateTranscriptionCostUsd: est } = await import("@/server/billing/usage-cost");
    expect(est(60, "whisper-1")).toBeCloseTo(0.012, 6);
    delete process.env.WHISPER_USD_PER_MINUTE;
    vi.resetModules();
  });

  it("estimates OpenAI token cost with default gpt-4o rates", () => {
    const usd = estimateLlmCostUsd({
      provider: "openai",
      model: "gpt-4o",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(2.5 + 10, 6);
  });

  it("estimates Anthropic token cost with default sonnet-scale rates", () => {
    const usd = estimateLlmCostUsd({
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(usd).toBeCloseTo(3 + 15, 6);
  });
});
