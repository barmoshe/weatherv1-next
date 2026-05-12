// @vitest-environment node
/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { getLlmProvider, LlmProviderError } from "@/server/providers/llm";

describe("getLlmProvider — selection", () => {
  it("returns Anthropic when only ANTHROPIC_API_KEY is set", () => {
    const provider = getLlmProvider({ anthropicKey: "ak-test", preferred: "auto" });
    expect(provider.id).toBe("anthropic");
  });

  it("returns OpenAI when only OPENAI_API_KEY is set", () => {
    const provider = getLlmProvider({ openaiKey: "sk-test", preferred: "auto" });
    expect(provider.id).toBe("openai");
  });

  it("prefers Anthropic when both keys are set (auto)", () => {
    const provider = getLlmProvider({
      anthropicKey: "ak-test",
      openaiKey: "sk-test",
      preferred: "auto",
    });
    expect(provider.id).toBe("anthropic");
  });

  it("honours explicit preference even when both keys exist", () => {
    const provider = getLlmProvider({
      anthropicKey: "ak-test",
      openaiKey: "sk-test",
      preferred: "openai",
    });
    expect(provider.id).toBe("openai");
  });

  it("throws when preference points at an unset key", () => {
    expect(() =>
      getLlmProvider({ openaiKey: "sk-test", preferred: "anthropic" }),
    ).toThrow(LlmProviderError);
  });

  it("throws with actionable message when no keys are configured", () => {
    try {
      getLlmProvider({ preferred: "auto" });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).code).toBe("llm_invalid_key");
      expect((err as Error).message).toMatch(/ANTHROPIC_API_KEY|OPENAI_API_KEY/);
    }
  });
});
