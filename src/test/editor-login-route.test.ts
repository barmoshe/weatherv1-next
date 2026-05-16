// @vitest-environment node
import argon2 from "argon2";
import { beforeAll, describe, expect, it, vi } from "vitest";

const KNOWN_PASSWORD = "editor-route-known-pw";

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// vi.mock instead of disk write — keeps the real prebuild-minted
// hashes in src/server/runtime/auth-passwords.generated.ts untouched
// across test runs.
let editorHash = "";
const adminHash = "unused-admin-hash-only-shape-matters";

vi.mock("@/server/runtime/auth-passwords.generated", () => ({
  get EDITOR_HASH() {
    return editorHash;
  },
  get ADMIN_HASH() {
    return adminHash;
  },
}));

beforeAll(async () => {
  editorHash = await argon2.hash(KNOWN_PASSWORD, ARGON2_OPTS);
});

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/auth/editor-login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/auth/editor-login", () => {
  it("issues a token + Set-Cookie on right credentials", async () => {
    const { POST } = await import("@/app/api/auth/editor-login/route");
    const res = await POST(buildRequest({
      username: "v1editor",
      password: KNOWN_PASSWORD,
    }) as never);
    const body = (await res.json()) as { success: boolean; token?: string };
    expect(body.success).toBe(true);
    expect(body.token).toMatch(/^[0-9a-f]{64}$/);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/weather_editor_session=/);
    expect(setCookie.toLowerCase()).toContain("httponly");
  });

  it("rejects wrong password with success:false and no cookie", async () => {
    const { POST } = await import("@/app/api/auth/editor-login/route");
    const res = await POST(buildRequest({
      username: "v1editor",
      password: "wrong-pw",
    }) as never);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects wrong username with success:false and no cookie", async () => {
    const { POST } = await import("@/app/api/auth/editor-login/route");
    const res = await POST(buildRequest({
      username: "intruder",
      password: KNOWN_PASSWORD,
    }) as never);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects missing fields without leaking a different error shape", async () => {
    const { POST } = await import("@/app/api/auth/editor-login/route");
    const res = await POST(buildRequest({ username: "v1editor" }) as never);
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(false);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
