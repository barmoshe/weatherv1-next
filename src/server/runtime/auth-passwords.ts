import argon2 from "argon2";
import { timingSafeEqual } from "node:crypto";

import {
  ADMIN_HASH,
  EDITOR_HASH,
  R2_APP_USERNAME,
} from "./auth-passwords.generated";

// Single source of truth: the username baked in at build time from the
// R2_APP_USERNAME GH secret is also the editor login username. The same
// (username, plaintext-password) pair authenticates the local editor
// session AND the Cloudflare R2 Worker Basic Auth.
export const EDITOR_USERNAME = R2_APP_USERNAME;

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
