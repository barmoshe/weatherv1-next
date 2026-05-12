// Shared error → HTTP response mapping used by `/api/plan`,
// `/api/replan_scene`, and `/api/transcribe`. Centralises Hebrew error
// strings and stable `error_code` values so the renderer can branch.

import { LlmProviderError } from "./llm";
import { TranscriptionProviderError } from "./transcription";

export interface MappedErrorResponse {
  body: {
    success: false;
    error: string;
    error_code: string;
    console_url?: string;
    provider?: string;
  };
  status: number;
}

const CONSOLE_URLS: Record<string, string> = {
  anthropic_billing: "https://console.anthropic.com/settings/billing",
  anthropic_keys: "https://console.anthropic.com/settings/keys",
  openai_billing: "https://platform.openai.com/account/billing",
  openai_keys: "https://platform.openai.com/api-keys",
};

export function mapProviderError(err: unknown): MappedErrorResponse | null {
  if (err instanceof LlmProviderError) {
    const providerHe = err.provider === "anthropic" ? "Anthropic" : "OpenAI";
    if (err.code === "llm_quota_exceeded") {
      return {
        status: 402,
        body: {
          success: false,
          error: `אזל מאגר ה-${providerHe} tokens. יש להוסיף קרדיט בחשבון.`,
          error_code: "llm_quota_exceeded",
          console_url: CONSOLE_URLS[`${err.provider}_billing`],
          provider: err.provider,
        },
      };
    }
    if (err.code === "llm_invalid_key") {
      return {
        status: 401,
        body: {
          success: false,
          error: `מפתח ${providerHe} לא תקין או לא הוגדר.`,
          error_code: "llm_invalid_key",
          console_url: CONSOLE_URLS[`${err.provider}_keys`],
          provider: err.provider,
        },
      };
    }
    if (err.code === "llm_rate_limited") {
      return {
        status: 429,
        body: {
          success: false,
          error: `${providerHe} מגביל קצב — נסה שוב בעוד רגע.`,
          error_code: "llm_rate_limited",
          provider: err.provider,
        },
      };
    }
    if (err.code === "llm_overloaded") {
      return {
        status: 503,
        body: {
          success: false,
          error: `${providerHe} עמוס כרגע. נסה שוב.`,
          error_code: "llm_overloaded",
          provider: err.provider,
        },
      };
    }
    return {
      status: 500,
      body: {
        success: false,
        error: err.message,
        error_code: "llm_unknown",
        provider: err.provider,
      },
    };
  }

  if (err instanceof TranscriptionProviderError) {
    if (err.code === "transcription_quota_exceeded") {
      return {
        status: 402,
        body: {
          success: false,
          error: "אזל מאגר ה-OpenAI tokens עבור תמלול. עבור לתמלול מקומי או הוסף קרדיט.",
          error_code: "transcription_quota_exceeded",
          console_url: CONSOLE_URLS.openai_billing,
          provider: err.provider,
        },
      };
    }
    if (err.code === "transcription_invalid_key") {
      return {
        status: 401,
        body: {
          success: false,
          error: "מפתח OpenAI לא תקין. עבור לתמלול מקומי או עדכן את המפתח.",
          error_code: "transcription_invalid_key",
          console_url: CONSOLE_URLS.openai_keys,
          provider: err.provider,
        },
      };
    }
    if (err.code === "transcription_no_model") {
      return {
        status: 409,
        body: {
          success: false,
          error: "אין מודל Whisper מקומי מותקן. הורד מודל מתוך ההגדרות.",
          error_code: "transcription_no_model",
          provider: err.provider,
        },
      };
    }
    if (err.code === "transcription_binary_missing") {
      return {
        status: 409,
        body: {
          success: false,
          error:
            "תוכנת whisper.cpp לא נמצאה. פתח את ההגדרות והתקן אותה, או הגדר OPENAI_API_KEY כתמלול מגיבוי.",
          error_code: "transcription_binary_missing",
          provider: err.provider,
        },
      };
    }
    return {
      status: 500,
      body: {
        success: false,
        error: err.message,
        error_code: "transcription_failed",
        provider: err.provider,
      },
    };
  }

  // Legacy string-matching fallback (preserves old behavior for unconverted
  // call sites): map plaintext OpenAI errors to the new contract.
  const msg = err instanceof Error ? err.message : String(err);
  if (
    msg.includes("insufficient_quota") ||
    msg.includes("exceeded your current quota") ||
    msg.includes("billing_hard_limit_reached")
  ) {
    return {
      status: 402,
      body: {
        success: false,
        error: "אזל מאגר ה-OpenAI tokens.",
        error_code: "llm_quota_exceeded",
        console_url: CONSOLE_URLS.openai_billing,
        provider: "openai",
      },
    };
  }
  if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
    return {
      status: 401,
      body: {
        success: false,
        error: "מפתח OpenAI לא תקין.",
        error_code: "llm_invalid_key",
        console_url: CONSOLE_URLS.openai_keys,
        provider: "openai",
      },
    };
  }
  return null;
}
