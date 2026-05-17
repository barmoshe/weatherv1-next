/**
 * Shared env loader for ad-hoc CLI scripts that run outside the Next.js
 * runtime (where `next` would normally load .env / .env.local for us).
 * No dotenv dep — same minimal parser used by scripts/check-r2-jobs-json.ts
 * since the script's inception.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_FILES = [".env.local", ".env"] as const;

/** Read `.env.local` then `.env` (first wins per key) into `process.env`. */
export function loadDotenvFiles(cwd: string = process.cwd(), files: readonly string[] = DEFAULT_FILES): void {
  for (const file of files) {
    const p = path.resolve(cwd, file);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq < 1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}
