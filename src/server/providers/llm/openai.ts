// OpenAI LLM provider.
//
// Preserves the original behaviour from the pre-provider-layer pipeline:
// chat.completions with `response_format: { type: "json_object" }`, then
// JSON.parse + Zod validate. Default model is `gpt-4o` to match what the
// pipeline shipped with; override via `OPENAI_MODEL` env.

import OpenAI from "openai";
import {
  type CompleteJsonArgs,
  type LlmProvider,
  LlmProviderError,
} from "./types";

const DEFAULT_MODEL = "gpt-4o";

export interface OpenAiProviderOptions {
  apiKey: string;
  model?: string;
}

export function createOpenAiProvider(opts: OpenAiProviderOptions): LlmProvider {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    throw new LlmProviderError(
      "OPENAI_API_KEY is required",
      "llm_invalid_key",
      "openai",
    );
  }
  const client = new OpenAI({ apiKey });
  const model = opts.model?.trim() || process.env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;

  return {
    id: "openai",
    async completeJson<T>(args: CompleteJsonArgs<T>): Promise<T> {
      let raw: unknown;
      try {
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: "system", content: args.systemPrompt },
            { role: "user", content: args.userPayload },
          ],
          response_format: { type: "json_object" },
          temperature: args.options?.temperature,
          seed: args.options?.seed,
          max_tokens: args.options?.maxTokens,
        });
        const content = response.choices[0]?.message?.content ?? "{}";
        raw = JSON.parse(content);
      } catch (err) {
        throw translateOpenAiError(err);
      }

      const parsed = args.schema.safeParse(raw);
      if (!parsed.success) {
        throw new LlmProviderError(
          `OpenAI response failed schema validation: ${parsed.error.message}`,
          "llm_invalid_response",
          "openai",
          parsed.error,
        );
      }
      return parsed.data;
    },
  };
}

function translateOpenAiError(err: unknown): LlmProviderError {
  const msg = err instanceof Error ? err.message : String(err);
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;

  if (
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("billing_hard_limit_reached")
  ) {
    return new LlmProviderError("OpenAI quota exceeded", "llm_quota_exceeded", "openai", err);
  }
  if (
    status === 401 ||
    msg.includes("invalid_api_key") ||
    msg.includes("Incorrect API key")
  ) {
    return new LlmProviderError("OpenAI API key is invalid", "llm_invalid_key", "openai", err);
  }
  if (status === 429) {
    return new LlmProviderError("OpenAI rate limit hit", "llm_rate_limited", "openai", err);
  }
  if (status === 503) {
    return new LlmProviderError("OpenAI is overloaded", "llm_overloaded", "openai", err);
  }
  return new LlmProviderError(`OpenAI call failed: ${msg}`, "llm_unknown", "openai", err);
}
