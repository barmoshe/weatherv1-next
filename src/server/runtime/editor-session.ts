import { randomBytes } from "node:crypto";

// In-memory set of valid editor session tokens for this Next process.
// Desktop mode: main process persists the token via safeStorage and
// re-injects it as WEATHER_EDITOR_SESSION_TOKEN on every child spawn,
// which seeds this set at module load so quit+relaunch keeps the
// editor signed in. Web mode: no persistence — a server restart logs
// everyone out, which is acceptable for dev.
//
// Backed by globalThis: Next 16 bundles `proxy.ts` (middleware) and
// route handlers as separate module graphs even in the Node runtime,
// so this file is instantiated twice. Without a shared bin, tokens
// issued by /api/auth/editor-login (route bundle) would be invisible
// to the proxy's auth check, and the cookie would round-trip but
// every subsequent /api/* call would 401. globalThis is the only
// shared surface across module graphs in the same Node process.
const SHARED_KEY = "__weatherv1EditorSessionTokens__";
type GlobalWithTokens = typeof globalThis & { [SHARED_KEY]?: Set<string> };
const g = globalThis as GlobalWithTokens;
const TOKENS: Set<string> = g[SHARED_KEY] ?? (g[SHARED_KEY] = new Set<string>());

const TOKEN_HEX_LENGTH = 64;

export function issueToken(): string {
  const token = randomBytes(32).toString("hex");
  TOKENS.add(token);
  return token;
}

export function isValidToken(token: string | undefined | null): boolean {
  return (
    typeof token === "string" &&
    token.length === TOKEN_HEX_LENGTH &&
    TOKENS.has(token)
  );
}

export function revokeToken(token: string): void {
  TOKENS.delete(token);
}

const seed = process.env.WEATHER_EDITOR_SESSION_TOKEN?.trim();
if (seed && seed.length === TOKEN_HEX_LENGTH) {
  TOKENS.add(seed);
}
