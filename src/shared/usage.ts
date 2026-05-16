import { z } from "zod";

export type UsageProviderId = "anthropic" | "openai";

/** One LLM API call normalized for aggregation and costing. */
export interface LlmCallUsage {
  provider: UsageProviderId;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  /**
   * OpenAI Chat Completions reports `usage.prompt_tokens_details.cached_tokens`
   * when a prefix cache hit occurs. These tokens are *also* included in
   * `input_tokens`; the cost estimator bills them at the cached rate.
   */
  cached_input_tokens?: number;
}

export interface CompleteJsonResult<T> {
  data: T;
  usage: LlmCallUsage;
}

export interface UsageCallRecord extends LlmCallUsage {
  step: string;
}

/** Persisted rollup on JobRecord (+ API / local history when synced). */
export const JobUsageSummarySchema = z.object({
  pricing_revision: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  /** Subset of `input_tokens` served from the provider's prefix cache. */
  cached_input_tokens: z.number().optional(),
  llm_cost_usd_estimate: z.number(),
  transcription_billed_audio_sec: z.number().optional(),
  transcription_model: z.string().optional(),
  transcription_cost_usd_estimate: z.number().optional(),
  total_cost_usd_estimate: z.number(),
});
export type JobUsageSummary = z.infer<typeof JobUsageSummarySchema>;

export const UsageCallRecordSchema: z.ZodType<UsageCallRecord> = z.object({
  step: z.string(),
  provider: z.enum(["anthropic", "openai"]),
  model: z.string(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  cache_read_input_tokens: z.number().optional(),
  cache_creation_input_tokens: z.number().optional(),
  cached_input_tokens: z.number().optional(),
});

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Map OpenAI Chat Completions `usage` onto LlmCallUsage. */
export function usageFromOpenAiChat(
  usage: Record<string, unknown> | undefined,
  provider: UsageProviderId,
  model: string,
): LlmCallUsage {
  if (!usage || typeof usage !== "object") {
    return { provider, model, input_tokens: 0, output_tokens: 0 };
  }
  const details = (usage as { prompt_tokens_details?: unknown }).prompt_tokens_details;
  const cached =
    details && typeof details === "object"
      ? num((details as { cached_tokens?: unknown }).cached_tokens)
      : 0;
  const out: LlmCallUsage = {
    provider,
    model,
    input_tokens: num(usage.prompt_tokens),
    output_tokens: num(usage.completion_tokens),
  };
  if (cached > 0) out.cached_input_tokens = cached;
  return out;
}

/** Map Anthropic Messages `usage` onto LlmCallUsage (snake_case or camelCase from SDK). */
export function usageFromAnthropicMessage(
  usage: Record<string, unknown> | undefined,
  provider: UsageProviderId,
  model: string,
): LlmCallUsage {
  if (!usage || typeof usage !== "object") {
    return { provider, model, input_tokens: 0, output_tokens: 0 };
  }
  const inTok =
    num(usage.input_tokens) ||
    num((usage as { inputTokens?: unknown }).inputTokens);
  const outTok =
    num(usage.output_tokens) ||
    num((usage as { outputTokens?: unknown }).outputTokens);
  const cacheRead =
    num(usage.cache_read_input_tokens) ||
    num((usage as { cacheReadInputTokens?: unknown }).cacheReadInputTokens);
  const cacheCreate =
    num(usage.cache_creation_input_tokens) ||
    num((usage as { cacheCreationInputTokens?: unknown }).cacheCreationInputTokens);
  const out: LlmCallUsage = {
    provider,
    model,
    input_tokens: inTok,
    output_tokens: outTok,
  };
  if (cacheRead > 0) out.cache_read_input_tokens = cacheRead;
  if (cacheCreate > 0) out.cache_creation_input_tokens = cacheCreate;
  return out;
}

export function sumLlmUsage(a: LlmCallUsage, b: LlmCallUsage): LlmCallUsage {
  if (a.provider !== b.provider || a.model !== b.model) {
    throw new Error("sumLlmUsage: provider+model must match");
  }
  const out: LlmCallUsage = {
    provider: a.provider,
    model: a.model,
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
  };
  const cr = (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0);
  const cc = (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0);
  const ci = (a.cached_input_tokens ?? 0) + (b.cached_input_tokens ?? 0);
  if (cr > 0) out.cache_read_input_tokens = cr;
  if (cc > 0) out.cache_creation_input_tokens = cc;
  if (ci > 0) out.cached_input_tokens = ci;
  return out;
}
