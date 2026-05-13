// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from "vitest";
import { z } from "zod";

const createMock = vi.fn();

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: vi.fn(() => ({
      messages: { create: createMock },
    })),
  };
});

beforeEach(() => {
  createMock.mockReset();
});

describe("Anthropic provider tool-use shape", () => {
  it("forces tool_choice to the schema tool and applies ephemeral cache_control when requested", async () => {
    const { createAnthropicProvider } = await import("@/server/providers/llm/anthropic");
    const provider = createAnthropicProvider({ apiKey: "ak-test", model: "claude-sonnet-4-6" });

    createMock.mockResolvedValueOnce({
      content: [
        {
          type: "tool_use",
          name: "demo_tool",
          input: { answer: 42 },
        },
      ],
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const out = await provider.completeJson({
      systemPrompt: "system",
      userPayload: "user",
      schema: z.object({ answer: z.number() }),
      schemaName: "demo_tool",
      schemaDescription: "demo",
      options: { temperature: 0.5, cacheSystemPrompt: true, maxTokens: 256 },
    });
    expect(out.data.answer).toBe(42);
    expect(out.usage.input_tokens).toBe(100);

    const call = createMock.mock.calls[0][0];
    expect(call.model).toBe("claude-sonnet-4-6");
    expect(call.tool_choice).toEqual({ type: "tool", name: "demo_tool" });
    expect(call.tools).toHaveLength(1);
    expect(call.tools[0].name).toBe("demo_tool");
    expect(call.tools[0].input_schema.type).toBe("object");
    // System prompt is wrapped in a TextBlockParam list and marked for ephemeral cache.
    expect(Array.isArray(call.system)).toBe(true);
    expect(call.system[0].type).toBe("text");
    expect(call.system[0].cache_control).toEqual({ type: "ephemeral" });
    expect(call.temperature).toBe(0.5);
    expect(call.max_tokens).toBe(256);
  });

  it("omits cache_control when cacheSystemPrompt is false", async () => {
    const { createAnthropicProvider } = await import("@/server/providers/llm/anthropic");
    const provider = createAnthropicProvider({ apiKey: "ak-test" });

    createMock.mockResolvedValueOnce({
      content: [{ type: "tool_use", name: "demo", input: { ok: true } }],
      usage: { input_tokens: 1, output_tokens: 2 },
    });

    await provider.completeJson({
      systemPrompt: "system",
      userPayload: "user",
      schema: z.object({ ok: z.boolean() }),
      schemaName: "demo",
      schemaDescription: "demo",
    });

    const call = createMock.mock.calls[0][0];
    expect(call.system[0].cache_control).toBeUndefined();
  });

  it("translates 401 / authentication_error to llm_invalid_key", async () => {
    const { createAnthropicProvider } = await import("@/server/providers/llm/anthropic");
    const { LlmProviderError } = await import("@/server/providers/llm/types");
    const provider = createAnthropicProvider({ apiKey: "ak-test" });

    const apiError = Object.assign(new Error("invalid x-api-key"), {
      status: 401,
      error: { error: { type: "authentication_error" } },
    });
    createMock.mockRejectedValueOnce(apiError);

    let caught: unknown;
    try {
      await provider.completeJson({
        systemPrompt: "system",
        userPayload: "user",
        schema: z.object({ ok: z.boolean() }),
        schemaName: "demo",
        schemaDescription: "demo",
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(LlmProviderError);
    expect((caught as { code: string }).code).toBe("llm_invalid_key");
  });
});
