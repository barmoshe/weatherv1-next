// LLM provider abstraction.
//
// The two LLM-driven steps in the pipeline (scene planning, segment picking)
// only need one capability from their provider: "given a system prompt and a
// user payload, return a JSON object that matches this Zod schema".
//
// Anthropic does not expose `response_format: { type: "json_object" }`. The
// reliable equivalent is tool_use with a forced tool_choice — the model fills
// in the tool's `input` and we read it back. So the provider interface is
// schema-first; the provider implementation is responsible for shaping the
// underlying API call (Anthropic vs OpenAI) to honour the schema.

import type { ZodSchema } from "zod";
import type { CompleteJsonResult } from "@/shared/usage";

export type LlmProviderId = "anthropic" | "openai";

export interface LlmCompletionOptions {
  /** Provider-agnostic 0..1 randomness knob. Mapped per-provider. */
  temperature?: number;
  /** Provider-agnostic determinism seed. Honoured by OpenAI; ignored by Anthropic (no seed parameter). */
  seed?: number;
  /** Cap on output tokens. Both providers honour. */
  maxTokens?: number;
  /**
   * If true, the system prompt is marked for prompt caching (Anthropic
   * `cache_control: { type: "ephemeral" }`). No-op for OpenAI.
   * Use for the big static prompts in scene-planner / picker.
   */
  cacheSystemPrompt?: boolean;
}

export interface CompleteJsonArgs<T> {
  systemPrompt: string;
  userPayload: string;
  /** Zod schema describing the expected JSON shape. */
  schema: ZodSchema<T>;
  /**
   * Human-readable name for the JSON shape. Used as the Anthropic tool name
   * and surfaced in logs. Must match `^[a-zA-Z0-9_-]{1,64}$`.
   */
  schemaName: string;
  /** Short description of the JSON shape (for the Anthropic tool description). */
  schemaDescription: string;
  options?: LlmCompletionOptions;
}

export interface LlmProvider {
  readonly id: LlmProviderId;
  readonly model?: string;
  /**
   * Get a structured JSON response from the provider. Always returns parsed,
   * schema-validated data — implementations are responsible for retries and
   * for translating provider-specific JSON-mode features into a uniform
   * Zod-validated shape.
   */
  completeJson<T>(args: CompleteJsonArgs<T>): Promise<CompleteJsonResult<T>>;
}

/**
 * Recognised classes of provider error so route handlers can map them to
 * stable HTTP responses regardless of which provider is active.
 */
export type LlmErrorCode =
  | "llm_invalid_key"
  | "llm_quota_exceeded"
  | "llm_rate_limited"
  | "llm_overloaded"
  | "llm_invalid_response"
  | "llm_unknown";

export class LlmProviderError extends Error {
  constructor(
    message: string,
    public readonly code: LlmErrorCode,
    public readonly provider: LlmProviderId,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LlmProviderError";
  }
}
