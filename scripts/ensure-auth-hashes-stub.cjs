#!/usr/bin/env node
// Ensures src/server/runtime/auth-passwords.generated.ts exists so Vite's
// import-analysis can load the auth-passwords module during `npm test`.
// Tests mock this module via vi.mock; the stub values below are never
// read at runtime. Real hashes are minted by scripts/emit-auth-hashes.cjs
// during `prebuild`. This script MUST NOT overwrite a *current* file —
// doing so would clobber the real local-dev hashes between
// `npm run build` and `npm test`. A file left by an older build that is
// missing an export is a different case: it fails typecheck and dev with a
// confusing error, so it gets replaced (a rebuild restores real hashes).
const fs = require("node:fs");
const path = require("node:path");

const OUT_PATH = path.join(
  __dirname,
  "..",
  "src",
  "server",
  "runtime",
  "auth-passwords.generated.ts",
);

const REQUIRED_EXPORTS = ["EDITOR_HASH", "ADMIN_HASH", "EDITOR_USERNAME"];

if (fs.existsSync(OUT_PATH)) {
  const current = fs.readFileSync(OUT_PATH, "utf8");
  const missing = REQUIRED_EXPORTS.filter((name) => !current.includes(`export const ${name}`));
  if (missing.length === 0) process.exit(0);
  process.stderr.write(
    `ensure-auth-hashes-stub: replacing a stale generated module (missing: ${missing.join(", ")}). ` +
      "Run `npm run build` to mint real hashes again.\n",
  );
}

fs.writeFileSync(
  OUT_PATH,
  '// STUB — overwritten by scripts/emit-auth-hashes.cjs during `npm run prebuild`.\n' +
    '// Tests mock this module via vi.mock; these values are never read at runtime.\n' +
    'export const EDITOR_HASH = "";\n' +
    'export const ADMIN_HASH = "";\n' +
    'export const EDITOR_USERNAME = "";\n',
);
