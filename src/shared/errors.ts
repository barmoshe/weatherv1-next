/**
 * UI-side error contract. Mirrors the structured fields the server already
 * returns from `mapProviderError` / job status routes, so the studio surfaces
 * can show a real reason instead of `String(err)`.
 *
 * Keep the shape narrow and serialisable — instances of this travel through
 * React state and `JSON.stringify` round-trips for the "Copy" affordance on
 * the error banner.
 */
export interface UiError {
  message: string;
  code?: string;
  provider?: string;
  consoleUrl?: string;
  step?: string;
  at?: string;
  /** Optional long-form details (e.g. picker_status JSON, ffmpeg stderr tail). */
  details?: string;
}

interface ApiErrorBody {
  error?: unknown;
  error_code?: unknown;
  error_provider?: unknown;
  provider?: unknown;
  error_console_url?: unknown;
  console_url?: unknown;
  failed_step?: unknown;
  step?: unknown;
  failed_at?: unknown;
  details?: unknown;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

interface ParsedApiBody {
  ui: UiError;
  /** True iff `body.error` carried a usable message. */
  hasMessage: boolean;
}

function parseApiBody(body: ApiErrorBody, fallback: string): ParsedApiBody {
  const message = str(body.error);
  return {
    ui: {
      message: message ?? fallback,
      code: str(body.error_code),
      provider: str(body.error_provider) ?? str(body.provider),
      consoleUrl: str(body.error_console_url) ?? str(body.console_url),
      step: str(body.failed_step) ?? str(body.step),
      at: str(body.failed_at),
      details: str(body.details),
    },
    hasMessage: !!message,
  };
}

/**
 * Normalize whatever the caller is holding (Error, fetch Response JSON,
 * server error envelope, plain string) into a `UiError`. Keep it forgiving:
 * if nothing maps cleanly, return a UiError with just `.message` set so the
 * banner can still render.
 */
export function toUiError(input: unknown, fallback = "שגיאה לא ידועה"): UiError {
  if (input == null) return { message: fallback };
  if (typeof input === "string") return { message: input || fallback };
  if (input instanceof Error) return { message: input.message || fallback };
  if (typeof input === "object") {
    const obj = input as ApiErrorBody & { message?: unknown };
    const parsed = parseApiBody(obj, fallback);
    if (parsed.hasMessage) return parsed.ui;
    const msg = str(obj.message);
    return { ...parsed.ui, message: msg ?? fallback };
  }
  return { message: String(input) || fallback };
}

/** Stringify a UiError for the "Copy" affordance — Hebrew message + LTR metadata. */
export function uiErrorToClipboard(err: UiError): string {
  const parts: string[] = [err.message];
  const meta: string[] = [];
  if (err.code) meta.push(`code=${err.code}`);
  if (err.step) meta.push(`step=${err.step}`);
  if (err.provider) meta.push(`provider=${err.provider}`);
  if (err.at) meta.push(`at=${err.at}`);
  if (meta.length) parts.push(meta.join(" "));
  if (err.consoleUrl) parts.push(err.consoleUrl);
  if (err.details) parts.push(err.details);
  return parts.join("\n");
}
