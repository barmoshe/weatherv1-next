// Anthropic LLM provider.
//
// Strategy:
//   - Use Messages API.
//   - Force structured JSON output via tool_use: declare one tool whose
//     `input_schema` is the JSON Schema derived from the caller's Zod schema,
//     pin `tool_choice: { type: "tool", name }`, and read the tool input back
//     as the response. This is the canonical Anthropic equivalent of OpenAI's
//     `response_format: { type: "json_object" }` — far more reliable than
//     asking the model to "respond with JSON only" in plain text.
//   - Cache the (large, static) system prompt with `cache_control: ephemeral`
//     when callers opt in. The picker + scene-planner system prompts are
//     several thousand tokens of context that don't change between calls; the
//     5-minute cache TTL turns the second-onward call into a 10% input price.

import Anthropic from "@anthropic-ai/sdk";
import { zodToJsonSchema } from "zod-to-json-schema";
import { usageFromAnthropicMessage } from "@/shared/usage";
import type { CompleteJsonResult } from "@/shared/usage";

const DEFAULT_MODEL = "claude-sonnet-4-6";
const DEFAULT_MAX_TOKENS = 8192;

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LlmProvider {
  const apiKey = opts.apiKey?.trim();
  if (!apiKey) {
    throw new LlmProviderError(
      "ANTHROPIC_API_KEY is required",
      "llm_invalid_key",
      "anthropic",
    );
  }
  const client = new Anthropic({ apiKey });
  const model = opts.model?.trim() || process.env.CLAUDE_MODEL?.trim() || DEFAULT_MODEL;

  return {
    id: "anthropic",
    model,
    async completeJson<T>(args: CompleteJsonArgs<T>): Promise<CompleteJsonResult<T>> {
      const inputSchema = zodToJsonSchema(args.schema, {
        // Anthropic tool input_schema is a JSON Schema object — strip the
        // top-level $schema/definitions wrapper the library adds by default.
        target: "openApi3",
        $refStrategy: "none",
      });

      const tool: Anthropic.Tool = {
        name: args.schemaName,
        description: args.schemaDescription,
        // zodToJsonSchema with target openApi3 returns a schema-shaped object.
        // The Anthropic SDK types `input_schema` as `{ type: "object"; ... }`;
        // cast is safe because all our Zod root shapes are objects.
        input_schema: inputSchema as Anthropic.Tool["input_schema"],
      };

      const systemBlock: Anthropic.TextBlockParam = {
        type: "text",
        text: args.systemPrompt,
      };
      if (args.options?.cacheSystemPrompt) {
        systemBlock.cache_control = { type: "ephemeral" };
      }

      let response: Anthropic.Message;
      try {
        response = await client.messages.create({
          model,
          max_tokens: args.options?.maxTokens ?? DEFAULT_MAX_TOKENS,
          temperature: args.options?.temperature,
          system: [systemBlock],
          tools: [tool],
          tool_choice: { type: "tool", name: args.schemaName },
          messages: [
            {
              role: "user",
              content: args.userPayload,
            },
          ],
        });
      } catch (err) {
        throw translateAnthropicError(err);
      }

      const toolUse = response.content.find(
        (block): block is Anthropic.ToolUseBlock =>
          block.type === "tool_use" && block.name === args.schemaName,
      );
      if (!toolUse) {
        throw new LlmProviderError(
          "Anthropic response did not include the requested tool_use block",
          "llm_invalid_response",
          "anthropic",
        );
      }

      const usage = usageFromAnthropicMessage(
        response.usage as Record<string, unknown> | undefined,
        "anthropic",
        model,
      );

      const parsed = args.schema.safeParse(toolUse.input);
      if (!parsed.success) {
        throw new LlmProviderError(
          `Anthropic tool input failed schema validation: ${parsed.error.message}`,
          "llm_invalid_response",
          "anthropic",
          parsed.error,
        );
      }
      return { data: parsed.data, usage };
    },
  };
}

function translateAnthropicError(err: unknown): LlmProviderError {
  const msg = err instanceof Error ? err.message : String(err);

  // The SDK exposes typed error classes; check by name to avoid coupling
  // to a specific minor version's class shape.
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status?: unknown }).status)
      : undefined;
  const errType =
    typeof err === "object" && err !== null && "error" in err
      ? ((err as { error?: { error?: { type?: string } } }).error?.error?.type ?? null)
      : null;

  if (status === 401 || errType === "authentication_error" || msg.includes("invalid x-api-key")) {
    return new LlmProviderError("Anthropic API key is invalid", "llm_invalid_key", "anthropic", err);
  }
  if (status === 403 || errType === "permission_error") {
    return new LlmProviderError("Anthropic API key lacks permission", "llm_invalid_key", "anthropic", err);
  }
  if (status === 429 || errType === "rate_limit_error") {
    return new LlmProviderError("Anthropic rate limit hit", "llm_rate_limited", "anthropic", err);
  }
  if (status === 529 || errType === "overloaded_error") {
    return new LlmProviderError("Anthropic API is overloaded", "llm_overloaded", "anthropic", err);
  }
  if (errType === "billing_error" || msg.includes("credit balance is too low")) {
    return new LlmProviderError("Anthropic quota exceeded", "llm_quota_exceeded", "anthropic", err);
  }
  return new LlmProviderError(`Anthropic call failed: ${msg}`, "llm_unknown", "anthropic", err);
}
