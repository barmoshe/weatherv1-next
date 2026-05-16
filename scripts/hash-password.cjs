#!/usr/bin/env node
/*
 * Offline helper: prompt for a password (no echo) and print its Argon2id
 * hash. Useful for verifying "does this plaintext hash to that stored
 * value?" — not part of the build or rotation flow.
 *
 * Usage: node scripts/hash-password.cjs
 */

const readline = require("node:readline");
const argon2 = require("argon2");

const ARGON2_OPTS = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    process.stdout.write(question);

    const onData = (char) => {
      const c = char.toString("utf8");
      if (c === "\r" || c === "\n" || c === "") {
        process.stdin.removeListener("data", onData);
        return;
      }
      // Re-print the prompt over the typed character
      readline.moveCursor(process.stdout, -1, 0);
      process.stdout.write(" ");
      readline.moveCursor(process.stdout, -1, 0);
    };
    process.stdin.on("data", onData);

    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

async function main() {
  const pw = await promptHidden("password: ");
  if (!pw) {
    process.stderr.write("empty password — aborting\n");
    process.exit(1);
  }
  const hash = await argon2.hash(pw, ARGON2_OPTS);
  process.stdout.write(hash + "\n");
}

main().catch((err) => {
  process.stderr.write(`hash-password: failed (${err.message})\n`);
  process.exit(1);
});
