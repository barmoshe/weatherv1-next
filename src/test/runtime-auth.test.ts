// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ENV_KEYS = [
  "WEATHER_WORKSPACE_DIR",
  "WEATHER_RUNTIME_DIR",
  "DESKTOP_MODE",
  "DESKTOP_SESSION_TOKEN",
] as const;

let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

async function importAuth() {
  vi.resetModules();
  const config = await import("@/server/runtime/config");
  config.resetRuntimeConfigForTests();
  return await import("@/server/runtime/auth");
}

function fakeRequest(headers: Record<string, string> = {}, cookies: Record<string, string> = {}) {
  return {
    headers: new Headers(headers),
    cookies: {
      get(name: string) {
        const value = cookies[name];
        return value === undefined ? undefined : { name, value };
      },
    },
  };
}

beforeEach(() => {
  originalEnv = {};
  for (const k of ENV_KEYS) {
    originalEnv[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = originalEnv[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe("isDesktopMode", () => {
  it("returns false when DESKTOP_MODE is unset", async () => {
    const { isDesktopMode } = await importAuth();
    expect(isDesktopMode()).toBe(false);
  });

  it("returns true when DESKTOP_MODE=1", async () => {
    process.env.DESKTOP_MODE = "1";
    const { isDesktopMode } = await importAuth();
    expect(isDesktopMode()).toBe(true);
  });

  it("returns false for any other DESKTOP_MODE value", async () => {
    process.env.DESKTOP_MODE = "true";
    const { isDesktopMode } = await importAuth();
    expect(isDesktopMode()).toBe(false);
  });
});

describe("isDesktopRequestAuthorized", () => {
  it("returns true in web mode regardless of header presence", async () => {
    const { isDesktopRequestAuthorized, DESKTOP_AUTH_HEADER } = await importAuth();
    expect(isDesktopRequestAuthorized(fakeRequest({})  as never)).toBe(true);
    expect(
      isDesktopRequestAuthorized(fakeRequest({ [DESKTOP_AUTH_HEADER]: "anything" }) as never),
    ).toBe(true);
  });

  it("returns false in desktop mode when header is missing", async () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "expected-token";
    const { isDesktopRequestAuthorized } = await importAuth();
    expect(isDesktopRequestAuthorized(fakeRequest({}) as never)).toBe(false);
  });

  it("returns true in desktop mode when header matches the configured token", async () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "expected-token";
    const { isDesktopRequestAuthorized, DESKTOP_AUTH_HEADER } = await importAuth();
    expect(
      isDesktopRequestAuthorized(
        fakeRequest({ [DESKTOP_AUTH_HEADER]: "expected-token" }) as never,
      ),
    ).toBe(true);
  });

  it("returns false in desktop mode when header does not match", async () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "expected-token";
    const { isDesktopRequestAuthorized, DESKTOP_AUTH_HEADER } = await importAuth();
    expect(
      isDesktopRequestAuthorized(fakeRequest({ [DESKTOP_AUTH_HEADER]: "wrong" }) as never),
    ).toBe(false);
  });

  it("returns false in desktop mode when lengths differ (no timing leak)", async () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "expected-token";
    const { isDesktopRequestAuthorized, DESKTOP_AUTH_HEADER } = await importAuth();
    // Different length must short-circuit before timingSafeEqual (which would throw).
    expect(
      isDesktopRequestAuthorized(
        fakeRequest({ [DESKTOP_AUTH_HEADER]: "short" }) as never,
      ),
    ).toBe(false);
    expect(
      isDesktopRequestAuthorized(
        fakeRequest({ [DESKTOP_AUTH_HEADER]: "much-longer-than-expected-token" }) as never,
      ),
    ).toBe(false);
  });

  it("returns false in desktop mode when no token is configured", async () => {
    process.env.DESKTOP_MODE = "1";
    // No DESKTOP_SESSION_TOKEN
    const { isDesktopRequestAuthorized, DESKTOP_AUTH_HEADER } = await importAuth();
    expect(
      isDesktopRequestAuthorized(fakeRequest({ [DESKTOP_AUTH_HEADER]: "x" }) as never),
    ).toBe(false);
  });
});

describe("assertDesktopAuth", () => {
  it("returns null when authorized", async () => {
    const { assertDesktopAuth } = await importAuth();
    expect(assertDesktopAuth(fakeRequest({}) as never)).toBeNull();
  });

  it("returns 401 NextResponse when not authorized", async () => {
    process.env.DESKTOP_MODE = "1";
    process.env.DESKTOP_SESSION_TOKEN = "expected-token";
    const { assertDesktopAuth } = await importAuth();
    const res = assertDesktopAuth(fakeRequest({}) as never);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(401);
    const body = await res!.json();
    expect(body).toMatchObject({ success: false, error: "Unauthorized desktop request" });
  });
});

describe("editor session", () => {
  // 64-char hex token (matches TOKEN_HEX_LENGTH expectation).
  const VALID_TOKEN = "a".repeat(64);

  it("readEditorSessionToken returns the cookie value", async () => {
    const { readEditorSessionToken, EDITOR_COOKIE_NAME } = await importAuth();
    expect(
      readEditorSessionToken(
        fakeRequest({}, { [EDITOR_COOKIE_NAME]: VALID_TOKEN }) as never,
      ),
    ).toBe(VALID_TOKEN);
  });

  it("readEditorSessionToken returns null when cookie is absent", async () => {
    const { readEditorSessionToken } = await importAuth();
    expect(readEditorSessionToken(fakeRequest({}, {}) as never)).toBeNull();
  });

  it("isEditorSessionAuthorized is false when cookie is missing", async () => {
    const { isEditorSessionAuthorized } = await importAuth();
    expect(isEditorSessionAuthorized(fakeRequest({}, {}) as never)).toBe(false);
  });

  it("isEditorSessionAuthorized is false for an unissued token of the right length", async () => {
    const { isEditorSessionAuthorized, EDITOR_COOKIE_NAME } = await importAuth();
    expect(
      isEditorSessionAuthorized(
        fakeRequest({}, { [EDITOR_COOKIE_NAME]: VALID_TOKEN }) as never,
      ),
    ).toBe(false);
  });

  it("isEditorSessionAuthorized is true for a token issued via issueToken()", async () => {
    const auth = await importAuth();
    const session = await import("@/server/runtime/editor-session");
    const token = session.issueToken();
    expect(
      auth.isEditorSessionAuthorized(
        fakeRequest({}, { [auth.EDITOR_COOKIE_NAME]: token }) as never,
      ),
    ).toBe(true);
  });

  it("isEditorSessionAuthorized is false after revokeToken()", async () => {
    const auth = await importAuth();
    const session = await import("@/server/runtime/editor-session");
    const token = session.issueToken();
    session.revokeToken(token);
    expect(
      auth.isEditorSessionAuthorized(
        fakeRequest({}, { [auth.EDITOR_COOKIE_NAME]: token }) as never,
      ),
    ).toBe(false);
  });

  it("assertEditorSession returns null when authorized, 401 otherwise", async () => {
    const auth = await importAuth();
    const session = await import("@/server/runtime/editor-session");
    const token = session.issueToken();
    expect(
      auth.assertEditorSession(
        fakeRequest({}, { [auth.EDITOR_COOKIE_NAME]: token }) as never,
      ),
    ).toBeNull();

    const denied = auth.assertEditorSession(fakeRequest({}, {}) as never);
    expect(denied).not.toBeNull();
    expect(denied!.status).toBe(401);
  });
});
