// Shared error → HTTP response mapping used by `/api/plan`,
// `/api/replan_scene`, and `/api/transcribe`. Centralises Hebrew error
// strings and stable `error_code` values so the renderer can branch.

import { ltr } from "@/shared/api-key";
import { LlmProviderError } from "./llm";
import { TranscriptionProviderError } from "./transcription";

export interface MappedErrorResponse {
  body: {
    success: false;
    error: string;
    error_code: string;
    /** For `llm_invalid_key`: missing | rejected | forbidden. */
    error_reason?: string;
    console_url?: string;
    provider?: string;
    details?: string;
  };
  status: number;
}

const CONSOLE_URLS: Record<string, string> = {
  anthropic_billing: "https://console.anthropic.com/settings/billing",
  anthropic_keys: "https://console.anthropic.com/settings/keys",
};

/** The Hebrew line for a key that failed, by reason; shared with the Settings key check. */
export function invalidKeyMessageHe(reason: string | undefined, keyHint?: string): string {
  const which = keyHint ? ` (${ltr(keyHint)})` : "";
  if (reason === "missing") {
    return "לא שמור מפתח Claude. פותחים את ההגדרות, מדביקים את המפתח ולוחצים \"שמירה ובדיקה\".";
  }
  if (reason === "forbidden") {
    return `למפתח Claude${which} אין הרשאה לשימוש הזה. בודקים בקונסול שהמפתח פעיל ושהארגון שלו פעיל, או יוצרים מפתח חדש.`;
  }
  if (reason === "rejected") {
    return `Anthropic דחו את מפתח Claude ששמור באפליקציה${which}. כנראה הוא לא הועתק במלואו או נמחק. יוצרים מפתח חדש בקונסול, מעתיקים עם כפתור ההעתקה ומדביקים בהגדרות.`;
  }
  return "מפתח Claude לא תקין או לא הוגדר.";
}

function detailLine(err: LlmProviderError): string | undefined {
  const parts: string[] = [];
  if (err.extra.keyHint) parts.push(`key=${err.extra.keyHint}`);
  if (err.extra.detail) parts.push(err.extra.detail);
  return parts.length ? parts.join("\n") : undefined;
}

export function mapProviderError(err: unknown): MappedErrorResponse | null {
  if (err instanceof LlmProviderError) {
    const providerHe = "Claude";
    if (err.code === "llm_quota_exceeded") {
      return {
        status: 402,
        body: {
          success: false,
          error: `אין קרדיט בחשבון ה-${providerHe} של המפתח. מוסיפים קרדיט בקונסול (Billing), באותו ארגון שבו נוצר המפתח.`,
          error_code: "llm_quota_exceeded",
          console_url: CONSOLE_URLS[`${err.provider}_billing`],
          provider: err.provider,
          details: detailLine(err),
        },
      };
    }
    if (err.code === "llm_invalid_key") {
      return {
        status: 401,
        body: {
          success: false,
          error: invalidKeyMessageHe(err.extra.reason, err.extra.keyHint),
          error_code: "llm_invalid_key",
          error_reason: err.extra.reason,
          console_url: CONSOLE_URLS[`${err.provider}_keys`],
          provider: err.provider,
          details: detailLine(err),
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
