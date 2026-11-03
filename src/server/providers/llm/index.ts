// LLM provider selection.
//
// Anthropic (Claude) only since v0.7.0: the app needs one key. The renderer's
// settings UI is the source of truth for the key: the Electron main injects it
// as `ANTHROPIC_API_KEY` at child spawn time (see `electron/config.cjs`
// `buildChildEnv`). On the Server/Web runtime it's a plain env var.

import { createAnthropicProvider } from "./anthropic";
import { type LlmProvider, LlmProviderError } from "./types";

export type { LlmProvider, LlmProviderId, LlmErrorCode } from "./types";
export { LlmProviderError } from "./types";

export interface LlmProviderConfig {
  anthropicKey?: string;
  /** Override the Anthropic model (otherwise `CLAUDE_MODEL` env / default). */
  anthropicModel?: string;
}

export function getLlmProvider(config?: LlmProviderConfig): LlmProvider {
  const cfg: LlmProviderConfig = config ?? configFromEnv();
  if (!cfg.anthropicKey) {
    throw new LlmProviderError(
      "ANTHROPIC_API_KEY is not configured. Add the Claude key in Settings.",
      "llm_invalid_key",
      "anthropic",
    );
  }
  return createAnthropicProvider({ apiKey: cfg.anthropicKey, model: cfg.anthropicModel });
}

function configFromEnv(): LlmProviderConfig {
  return {
    anthropicKey: trim(process.env.ANTHROPIC_API_KEY),
    anthropicModel: trim(process.env.CLAUDE_MODEL),
  };
}

function trim(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}
