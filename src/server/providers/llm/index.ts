// LLM provider selection.
//
// Selection rules (first match wins):
//   1. Explicit pin via `LLM_PROVIDER` env. Errors loudly if the pinned
//      provider's key isn't configured.
//   2. Auto: prefer Anthropic if `ANTHROPIC_API_KEY` is set, otherwise
//      fall back to OpenAI if `OPENAI_API_KEY` is set.
//   3. No usable key → throw with an actionable message.
//
// The renderer's settings UI is the source of truth for keys: the Electron
// main injects them as env vars at child spawn time (see `electron/config.cjs`
// `buildChildEnv`). On the Server/Web runtime they're plain env vars.

import { createAnthropicProvider } from "./anthropic";
import { createOpenAiProvider } from "./openai";
import { type LlmProvider, type LlmProviderId, LlmProviderError } from "./types";

export type { LlmProvider, LlmProviderId, LlmErrorCode } from "./types";
export { LlmProviderError } from "./types";

export interface LlmProviderConfig {
  anthropicKey?: string;
  openaiKey?: string;
  /** When set, force this provider; throw if its key isn't configured. */
  preferred?: LlmProviderId | "auto";
  /** Override the Anthropic model (otherwise `CLAUDE_MODEL` env / default). */
  anthropicModel?: string;
  /** Override the OpenAI model (otherwise `OPENAI_MODEL` env / default). */
  openaiModel?: string;
}

export function getLlmProvider(config?: LlmProviderConfig): LlmProvider {
  const cfg: LlmProviderConfig = config ?? configFromEnv();
  const preferred = cfg.preferred ?? "auto";

  if (preferred === "anthropic") {
    if (!cfg.anthropicKey) {
      throw new LlmProviderError(
        "LLM_PROVIDER=anthropic but ANTHROPIC_API_KEY is not configured",
        "llm_invalid_key",
        "anthropic",
      );
    }
    return createAnthropicProvider({ apiKey: cfg.anthropicKey, model: cfg.anthropicModel });
  }

  if (preferred === "openai") {
    if (!cfg.openaiKey) {
      throw new LlmProviderError(
        "LLM_PROVIDER=openai but OPENAI_API_KEY is not configured",
        "llm_invalid_key",
        "openai",
      );
    }
    return createOpenAiProvider({ apiKey: cfg.openaiKey, model: cfg.openaiModel });
  }

  if (cfg.anthropicKey) {
    return createAnthropicProvider({ apiKey: cfg.anthropicKey, model: cfg.anthropicModel });
  }
  if (cfg.openaiKey) {
    return createOpenAiProvider({ apiKey: cfg.openaiKey, model: cfg.openaiModel });
  }

  throw new LlmProviderError(
    "No LLM provider key configured. Set ANTHROPIC_API_KEY or OPENAI_API_KEY in Settings.",
    "llm_invalid_key",
    "anthropic",
  );
}

function configFromEnv(): LlmProviderConfig {
  const preferredRaw = process.env.LLM_PROVIDER?.trim().toLowerCase();
  const preferred: LlmProviderConfig["preferred"] =
    preferredRaw === "anthropic" || preferredRaw === "openai" ? preferredRaw : "auto";
  return {
    anthropicKey: trim(process.env.ANTHROPIC_API_KEY),
    openaiKey: trim(process.env.OPENAI_API_KEY),
    preferred,
    anthropicModel: trim(process.env.CLAUDE_MODEL),
    openaiModel: trim(process.env.OPENAI_MODEL),
  };
}

function trim(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t ? t : undefined;
}
