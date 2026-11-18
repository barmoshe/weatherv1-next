// "Does the saved Claude key work?" answered with one tiny real request, so
// Settings can say so before a forecast fails on it. A 1-token Messages call
// on the model the planner uses checks the key, the model access and the
// credit in one go (it costs a few millionths of a dollar).

import {
  apiKeyHint,
  apiKeyKind,
  apiKeyKindWarningHe,
  cleanApiKey,
  type KeyCheckResult,
} from "@/shared/api-key";
import { anthropicModel, createAnthropicClient, translateAnthropicError } from "./anthropic";

export type { KeyCheckResult, KeyCheckStatus } from "@/shared/api-key";

export async function checkAnthropicKey(rawKey: string | undefined): Promise<KeyCheckResult> {
  const checked_at = new Date().toISOString();
  const key = cleanApiKey(rawKey);
  if (!key) {
    return { ok: false, status: "missing", message: "לא שמור מפתח Claude.", checked_at };
  }
  const key_hint = apiKeyHint(key);
  // Tokens that are certainly not API keys get the plain reason without a
  // call. A format we don't recognise is still asked about: Anthropic decides.
  const kind = apiKeyKind(key);
  if (kind === "oauth" || kind === "admin" || kind === "openai") {
    return { ok: false, status: "not_api_key", message: apiKeyKindWarningHe(kind) ?? "", key_hint, checked_at };
  }
  const model = anthropicModel();
  try {
    await createAnthropicClient(key).messages.create({
      model,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    return { ok: true, status: "ok", message: "המפתח עובד.", key_hint, model, checked_at };
  } catch (err) {
    const mapped = translateAnthropicError(err, key_hint);
    const detail = mapped.extra.detail;
    if (mapped.code === "llm_invalid_key") {
      const forbidden = mapped.extra.reason === "forbidden";
      return {
        ok: false,
        status: forbidden ? "forbidden" : "rejected",
        message: forbidden
          ? "למפתח אין הרשאה. בודקים בקונסול שהמפתח והארגון שלו פעילים, או יוצרים מפתח חדש."
          : "Anthropic דחו את המפתח. כנראה הוא לא הועתק במלואו או נמחק. יוצרים מפתח חדש ומעתיקים עם כפתור ההעתקה.",
        key_hint,
        model,
        detail,
        checked_at,
      };
    }
    if (mapped.code === "llm_quota_exceeded") {
      return {
        ok: false,
        status: "no_credit",
        message: "המפתח תקין, אבל אין קרדיט בארגון שלו. מוסיפים קרדיט בקונסול (Billing) באותו ארגון.",
        key_hint,
        model,
        detail,
        checked_at,
      };
    }
    if (mapped.code === "llm_rate_limited" || mapped.code === "llm_overloaded") {
      // Anthropic only answers these to a key it accepted.
      return {
        ok: true,
        status: "busy",
        message: "המפתח עובד (Claude עמוס כרגע, זה עובר לבד).",
        key_hint,
        model,
        detail,
        checked_at,
      };
    }
    const offline = /fetch|network|connection|ENOTFOUND|timed? ?out/i.test(detail ?? "");
    return {
      ok: false,
      status: offline ? "network" : "unknown",
      message: offline
        ? "אין חיבור ל-Anthropic. בודקים את האינטרנט ומנסים שוב."
        : "הבדיקה נכשלה מסיבה לא צפויה. הפרטים מתחת.",
      key_hint,
      model,
      detail,
      checked_at,
    };
  }
}
