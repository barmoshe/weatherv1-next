// @vitest-environment node
import argon2 from "argon2";
import { beforeAll, describe, expect, it, vi } from "vitest";

const KNOWN_PASSWORD = "admin-route-known-pw";

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Use vi.mock so this test does not depend on the shared on-disk
// `auth-passwords.generated.ts` fixture — multiple test files writing
// that file concurrently from different workers caused a race.
let adminHash = "";
const editorHash = "unused-editor-hash-only-shape-matters";

vi.mock("@/server/runtime/auth-passwords.generated", () => ({
  get EDITOR_HASH() {
    return editorHash;
  },
  get ADMIN_HASH() {
    return adminHash;
  },
  R2_APP_USERNAME: "v1editor",
}));

beforeAll(async () => {
  adminHash = await argon2.hash(KNOWN_PASSWORD, ARGON2_OPTS);
});

function buildRequest(body: unknown): Request {
  return new Request("http://localhost/api/admin/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/admin/verify", () => {
  it("returns { ok: true } for the right password", async () => {
    const { POST } = await import("@/app/api/admin/verify/route");
    const res = await POST(buildRequest({ password: KNOWN_PASSWORD }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("returns { ok: false } for the wrong password", async () => {
    const { POST } = await import("@/app/api/admin/verify/route");
    const res = await POST(buildRequest({ password: "wrong-pw" }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });

  it("returns { ok: false } when the body is missing the password field", async () => {
    const { POST } = await import("@/app/api/admin/verify/route");
    const res = await POST(buildRequest({}) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(false);
  });
});
