import fs from "node:fs";
import path from "node:path";

import argon2 from "argon2";
import { beforeAll, describe, expect, it } from "vitest";

const KNOWN_EDITOR = "editor-known-pw";
const KNOWN_ADMIN = "admin-known-pw";

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

// The generated file is gitignored and normally emitted by the prebuild
// step. For tests we mint our own hashes from known plaintext and write
// the file directly so the module under test can import it. We leave the
// file in place afterwards — subsequent test runs and `npm run build`
// will simply overwrite it.
beforeAll(async () => {
  const editorHash = await argon2.hash(KNOWN_EDITOR, ARGON2_OPTS);
  const adminHash = await argon2.hash(KNOWN_ADMIN, ARGON2_OPTS);
  const body =
    "// Test-fixture hashes written by src/test/auth-passwords.test.ts.\n" +
    `export const EDITOR_HASH = ${JSON.stringify(editorHash)};\n` +
    `export const ADMIN_HASH = ${JSON.stringify(adminHash)};\n`;
  fs.writeFileSync(GENERATED_PATH, body, "utf8");
});

describe("auth-passwords verify", () => {
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
