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
};

export function mapProviderError(err: unknown): MappedErrorResponse | null {
  if (err instanceof LlmProviderError) {
    const providerHe = "Claude";
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
    if (err.code === "transcription_no_model") {
      return {
        status: 409,
        body: {
          success: false,
          error: "מודל התמלול בעברית עדיין לא הורד. פתח את ההגדרות והורד אותו (פעם אחת, כ-1.6GB).",
          error_code: "transcription_no_model",
          provider: err.provider,
        },
      };
    }
    if (err.code === "transcription_binary_missing") {
      return {
        status: 500,
        body: {
          success: false,
          error: "רכיב התמלול המקומי חסר בהתקנה. התקן מחדש את WeatherV1.",
          error_code: "transcription_binary_missing",
          provider: err.provider,
        },
      };
    }
    return {
      status: 500,
      body: {
        success: false,
        error: `התמלול המקומי נכשל: ${err.message}`,
        error_code: "transcription_failed",
        provider: err.provider,
      },
    };
  }

  return null;
}
