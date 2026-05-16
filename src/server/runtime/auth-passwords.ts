import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";

import { ADMIN_HASH, EDITOR_HASH } from "./auth-passwords.generated";

const EDITOR_USERNAME = "v1editor";

export async function verifyEditorLogin(
  username: string,
  password: string,
): Promise<boolean> {
  // Constant-time username compare. Lengths must match before timingSafeEqual,
  // and we want the comparison itself to not short-circuit on a length mismatch.
  const expected = Buffer.from(EDITOR_USERNAME);
  const given = Buffer.from(username);
  if (given.length !== expected.length) return false;
  if (!timingSafeEqual(given, expected)) return false;
  return argon2.verify(EDITOR_HASH, password);
}

export async function verifyAdminPassword(password: string): Promise<boolean> {
  return argon2.verify(ADMIN_HASH, password);
}
