import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("editor-session", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env.WEATHER_EDITOR_SESSION_TOKEN;
  });

  afterEach(() => {
    delete process.env.WEATHER_EDITOR_SESSION_TOKEN;
  });

  it("issueToken returns a 64-hex string and marks it valid", async () => {
    const { issueToken, isValidToken } = await import(
      "@/server/runtime/editor-session"
    );
    const token = issueToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isValidToken(token)).toBe(true);
  });

  it("rejects unknown, empty, and wrong-length tokens", async () => {
    const { isValidToken } = await import("@/server/runtime/editor-session");
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
    expect(isValidToken("")).toBe(false);
    expect(isValidToken("a".repeat(63))).toBe(false);
    expect(isValidToken("a".repeat(64))).toBe(false); // valid length, never issued
  });

  it("revokeToken removes a previously issued token", async () => {
    const { issueToken, isValidToken, revokeToken } = await import(
      "@/server/runtime/editor-session"
    );
    const token = issueToken();
    expect(isValidToken(token)).toBe(true);
    revokeToken(token);
    expect(isValidToken(token)).toBe(false);
  });

  it("seeds the token set from WEATHER_EDITOR_SESSION_TOKEN at module load", async () => {
    const seed = "b".repeat(64);
    process.env.WEATHER_EDITOR_SESSION_TOKEN = seed;
    const { isValidToken } = await import("@/server/runtime/editor-session");
    expect(isValidToken(seed)).toBe(true);
  });

  it("ignores malformed env seeds", async () => {
    process.env.WEATHER_EDITOR_SESSION_TOKEN = "not-hex";
    const { isValidToken } = await import("@/server/runtime/editor-session");
    expect(isValidToken("not-hex")).toBe(false);
  });
});
