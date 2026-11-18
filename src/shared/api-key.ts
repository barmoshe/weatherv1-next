// What an editor pastes into the Claude key field, made usable and explained.
//
// Keys come from the Console page, a password manager, a chat or a note, and
// pick up invisible characters on the way (RTL marks from Hebrew text,
// zero-width spaces, line breaks, quotes). Any of those makes Anthropic answer
// 401 or makes the browser refuse the header. And the field gets things that
// are not API keys at all: a Claude Code subscription token, an admin key, an
// OpenAI key. Both are caught here, before a forecast fails on them.

export type ApiKeyKind = "empty" | "api" | "oauth" | "admin" | "openai" | "unknown";

/** What `/api/llm/check` answers about the saved key. */
export type KeyCheckStatus =
  | "ok"
  | "missing"
  | "not_api_key"
  | "rejected"
  | "forbidden"
  | "no_credit"
  | "busy"
  | "network"
  | "unknown";

export interface KeyCheckResult {
  ok: boolean;
  status: KeyCheckStatus;
  /** Hebrew line for Settings. */
  message: string;
  key_hint?: string;
  model?: string;
  detail?: string;
  checked_at: string;
}

/** Strips whitespace, invisible and non-ASCII characters, and wrapping quotes. */
export function cleanApiKey(raw: string | null | undefined): string {
  if (!raw) return "";
  // Printable ASCII without space is everything a real key is made of.
  const ascii = Array.from(raw)
    .filter((ch) => {
      const c = ch.charCodeAt(0);
      return c > 0x20 && c < 0x7f;
    })
    .join("");
  return ascii.replace(/^["'`]+|["'`]+$/g, "");
}

export function apiKeyKind(key: string): ApiKeyKind {
  if (!key) return "empty";
  // The Console's key formats change (sk-ant-api03-… for older keys,
  // sk-ant-usr-… for keys that act as a user since Nov 2026). Only the two
  // known non-API tokens are named; any other sk-ant- key is an API key and
  // Anthropic's own answer decides whether it works.
  if (key.startsWith("sk-ant-oat")) return "oauth";
  if (key.startsWith("sk-ant-admin")) return "admin";
  if (key.startsWith("sk-ant-")) return "api";
  if (key.startsWith("sk-proj-") || key.startsWith("sk-svcacct-") || /^sk-[A-Za-z0-9]{20,}$/.test(key)) return "openai";
  return "unknown";
}

/**
 * A short, safe way to name a key on screen: its prefix and last four
 * characters, the same hint the Console shows next to each key.
 */
export function apiKeyHint(key: string): string {
  if (!key) return "";
  if (key.length < 24) return "…";
  // Only a known key prefix is shown; anything else pasted here (a password
  // a browser autofilled, say) shows only its last four characters.
  const known = /^(sk-ant-[a-z]+\d*|sk-proj|sk-svcacct)-/.exec(key);
  return known ? `${known[1]}…${key.slice(-4)}` : `…${key.slice(-4)}`;
}

/** Keeps an English token (a key prefix, a host) whole and left-to-right inside a Hebrew line. */
export function ltr(text: string): string {
  return `\u2066${text}\u2069`;
}

/** Hebrew warning for a key that is clearly not a Claude API key, or null. */
export function apiKeyKindWarningHe(kind: ApiKeyKind): string | null {
  switch (kind) {
    case "oauth":
      return `זה טוקן של מנוי Claude, לא מפתח API. יוצרים מפתח ב-${ltr("console.anthropic.com")} תחת API Keys.`;
    case "admin":
      return `זה מפתח ניהול (Admin) של הקונסול, לא מפתח API רגיל. יוצרים מפתח רגיל תחת API Keys.`;
    case "openai":
      return `זה נראה כמו מפתח של OpenAI. האפליקציה עובדת עם Claude: יוצרים מפתח ב-${ltr("console.anthropic.com")} תחת API Keys.`;
    case "unknown":
      return `זה לא נראה כמו מפתח של Claude. מפתח API מתחיל ב-${ltr("sk-ant-")} ומעתיקים אותו במלואו עם כפתור ההעתקה בקונסול.`;
    default:
      return null;
  }
}
