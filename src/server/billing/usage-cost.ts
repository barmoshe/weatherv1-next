/**
 * Local cost estimates from public list-pricing snapshots. Not authoritative billing.
 * Sources: https://openai.com/api/pricing/ https://www.anthropic.com/pricing
 */

import type { LlmCallUsage } from "@/shared/usage";

/** Bump when table below changes; stamped on JobRecord.usage_summary. */
export const PRICING_REVISION = "weatherv1-2026-02-estimate-v1";

const MTok = 1_000_000;

/** OpenAI Whisper `whisper-1`: $0.006/min (model page); override via env. */
const DEFAULT_WHISPER_USD_PER_MINUTE = 0.006;

function envNum(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** USD per minute of audio for transcription models. */
const TRANSCRIPTION_RATE_PER_MINUTE: Record<string, number> = {
  "whisper-1": envNum("WHISPER_USD_PER_MINUTE", DEFAULT_WHISPER_USD_PER_MINUTE),
  "gpt-4o-transcribe": envNum("OPENAI_TRANSCRIBE_GPT4O_USD_PER_MINUTE", 0.006),
  "gpt-4o-mini-transcribe": envNum("OPENAI_TRANSCRIBE_GPT4O_MINI_USD_PER_MINUTE", 0.003),
};

type LlmRateRow = { inPerMtok: number; outPerMtok: number };

function openAiRates(model: string): LlmRateRow {
  const m = model.toLowerCase();
  const gpt4oIn = envNum("OPENAI_GPT4O_INPUT_PER_MTOK_USD", 2.5);
  const gpt4oOut = envNum("OPENAI_GPT4O_OUTPUT_PER_MTOK_USD", 10);
  if (m.includes("gpt-4o")) return { inPerMtok: gpt4oIn, outPerMtok: gpt4oOut };
  if (m.includes("gpt-5")) return { inPerMtok: 5, outPerMtok: 25 };
  return { inPerMtok: gpt4oIn, outPerMtok: gpt4oOut };
}

function anthropicRates(model: string): LlmRateRow {
  const m = model.toLowerCase();
  const sonnetIn = envNum("ANTHROPIC_SONNET_INPUT_PER_MTOK_USD", 3);
  const sonnetOut = envNum("ANTHROPIC_SONNET_OUTPUT_PER_MTOK_USD", 15);
  if (m.includes("opus")) return { inPerMtok: 15, outPerMtok: 75 };
  if (m.includes("haiku")) return { inPerMtok: 1, outPerMtok: 5 };
  if (m.includes("sonnet") || m.includes("claude")) return { inPerMtok: sonnetIn, outPerMtok: sonnetOut };
  return { inPerMtok: sonnetIn, outPerMtok: sonnetOut };
}

/**
 * Token-based LLM estimate. Uses headline input/output counts; may diverge when
 * prompt caching discounts apply heavily (see vendor pricing docs).
 */
export function estimateLlmCostUsd(usage: LlmCallUsage): number {
  const row =
    usage.provider === "openai" ? openAiRates(usage.model) : anthropicRates(usage.model);
  return (usage.input_tokens / MTok) * row.inPerMtok + (usage.output_tokens / MTok) * row.outPerMtok;
}

export function estimateTranscriptionCostUsd(billedAudioSeconds: number, transcriptionModel: string): number {
  const key = transcriptionModel.trim().toLowerCase();
  const perMin =
    TRANSCRIPTION_RATE_PER_MINUTE[key] ??
    TRANSCRIPTION_RATE_PER_MINUTE["whisper-1"] ??
    DEFAULT_WHISPER_USD_PER_MINUTE;
  return (billedAudioSeconds / 60) * perMin;
}
