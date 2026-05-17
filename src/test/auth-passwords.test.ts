import argon2 from "argon2";
import { beforeAll, describe, expect, it, vi } from "vitest";

const KNOWN_EDITOR = "editor-known-pw";
const KNOWN_ADMIN = "admin-known-pw";

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Use vi.mock so this test does NOT overwrite the gitignored
// auth-passwords.generated.ts on disk. Writing to that file from
// tests clobbers the real hashes minted by `npm run prebuild` from
// your .env, leaving editor/admin login broken until the next build.
let editorHash = "";
let adminHash = "";

vi.mock("@/server/runtime/auth-passwords.generated", () => ({
  get EDITOR_HASH() {
    return editorHash;
  },
  get ADMIN_HASH() {
    return adminHash;
  },
  R2_APP_USERNAME: "v1editor",
}));

describe("auth-passwords verify", () => {
  beforeAll(async () => {
    editorHash = await argon2.hash(KNOWN_EDITOR, ARGON2_OPTS);
    adminHash = await argon2.hash(KNOWN_ADMIN, ARGON2_OPTS);
  });

  it("accepts the correct editor username and password", async () => {
    const { verifyEditorLogin } = await import(
      "@/server/runtime/auth-passwords"
    );
    await expect(verifyEditorLogin("v1editor", KNOWN_EDITOR)).resolves.toBe(
      true,
    );
  });

  it("rejects a wrong editor username", async () => {
    const { verifyEditorLogin } = await import(
      "@/server/runtime/auth-passwords"
    );
    await expect(verifyEditorLogin("v1edito", KNOWN_EDITOR)).resolves.toBe(
      false,
    );
    await expect(verifyEditorLogin("admin", KNOWN_EDITOR)).resolves.toBe(false);
  });

  it("rejects a wrong editor password", async () => {
    const { verifyEditorLogin } = await import(
      "@/server/runtime/auth-passwords"
    );
    await expect(verifyEditorLogin("v1editor", "wrong-pw")).resolves.toBe(
      false,
    );
  });

  it("accepts the correct admin password", async () => {
    const { verifyAdminPassword } = await import(
      "@/server/runtime/auth-passwords"
    );
    await expect(verifyAdminPassword(KNOWN_ADMIN)).resolves.toBe(true);
  });

  it("rejects a wrong admin password", async () => {
    const { verifyAdminPassword } = await import(
      "@/server/runtime/auth-passwords"
    );
    await expect(verifyAdminPassword("wrong-pw")).resolves.toBe(false);
  });
});
