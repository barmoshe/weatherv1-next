#!/usr/bin/env node
// Ensures src/server/runtime/auth-passwords.generated.ts exists so Vite's
// import-analysis can load the auth-passwords module during `npm test`.
// Tests mock this module via vi.mock; the stub values below are never
// read at runtime. Real hashes are minted by scripts/emit-auth-hashes.cjs
// during `prebuild`. This script MUST NOT overwrite an existing file —
// doing so would clobber the real local-dev hashes between
// `npm run build` and `npm test`.
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

if (fs.existsSync(OUT_PATH)) process.exit(0);

fs.writeFileSync(
  OUT_PATH,
  '// STUB — overwritten by scripts/emit-auth-hashes.cjs during `npm run prebuild`.\n' +
    '// Tests mock this module via vi.mock; these values are never read at runtime.\n' +
    'export const EDITOR_HASH = "";\n' +
    'export const ADMIN_HASH = "";\n',
);
