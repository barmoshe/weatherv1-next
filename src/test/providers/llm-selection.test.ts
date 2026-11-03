// @vitest-environment node
/* @vitest-environment node */

import { describe, expect, it } from "vitest";
import { getLlmProvider, LlmProviderError } from "@/server/providers/llm";

describe("getLlmProvider — selection", () => {
  it("returns Anthropic when the Claude key is set", () => {
    const provider = getLlmProvider({ anthropicKey: "ak-test" });
    expect(provider.id).toBe("anthropic");
  });

  it("honours a model override", () => {
    const provider = getLlmProvider({ anthropicKey: "ak-test", anthropicModel: "claude-test" });
    expect(provider.model).toBe("claude-test");
  });

  it("throws with an actionable message when no key is configured", () => {
    try {
      getLlmProvider({});
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmProviderError);
      expect((err as LlmProviderError).code).toBe("llm_invalid_key");
      expect((err as Error).message).toMatch(/ANTHROPIC_API_KEY/);
    }
  });
});
