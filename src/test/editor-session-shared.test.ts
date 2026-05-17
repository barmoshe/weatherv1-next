// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

// Regression for the Next 16 module-graph split: proxy.ts (middleware)
// and route handlers are bundled separately, so editor-session.ts is
// instantiated twice in the same Node process. The TOKENS set must be
// backed by globalThis so both bundles see the same store; otherwise
// /api/auth/editor-login adds the token in one Set and the proxy looks
// it up in the other, and every /api/* call returns 401.
describe("editor-session shared token store", () => {
  it("persists issued tokens through a module re-import", async () => {
    const a = await import("@/server/runtime/editor-session");
    const token = a.issueToken();
    expect(a.isValidToken(token)).toBe(true);

    // Force a fresh module instance, mirroring what Next does when it
    // bundles proxy.ts and route handlers into separate graphs.
    vi.resetModules();
    const b = await import("@/server/runtime/editor-session");

    expect(b).not.toBe(a);
    expect(b.isValidToken(token)).toBe(true);
  });

  it("rejects unknown tokens", async () => {
    const { isValidToken } = await import("@/server/runtime/editor-session");
    expect(isValidToken("not-a-real-token")).toBe(false);
    expect(isValidToken(null)).toBe(false);
    expect(isValidToken(undefined)).toBe(false);
  });
});
