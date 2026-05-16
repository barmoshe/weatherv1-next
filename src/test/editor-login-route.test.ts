// @vitest-environment node
import fs from "node:fs";
import path from "node:path";

import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";

const KNOWN_PASSWORD = "editor-route-known-pw";

const GENERATED_PATH = path.join(
  __dirname,
  "..",
  "server",
  "runtime",
  "auth-passwords.generated.ts",
);

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Same fixture-write pattern as src/test/auth-passwords.test.ts —
// emit the gitignored generated module so the route under test can
// import it through the real verify wrapper.
beforeAll(async () => {
  const editorHash = await argon2.hash(KNOWN_PASSWORD, ARGON2_OPTS);
  const adminHash = await argon2.hash("unused-admin-pw", ARGON2_OPTS);
  const body =
    "// Test-fixture hashes written by src/test/editor-login-route.test.ts.\n" +
    `export const EDITOR_HASH = ${JSON.stringify(editorHash)};\n` +
    `export const ADMIN_HASH = ${JSON.stringify(adminHash)};\n`;
  fs.writeFileSync(GENERATED_PATH, body, "utf8");
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
