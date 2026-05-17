/**
 * Atomic JSON read/write/update under a cross-process advisory lock.
 *
 * Generalizes the pattern used by `LocalCatalogStore`: ensure parent dir +
 * tmp file + rename + `proper-lockfile` for the read-modify-write window.
 * All payloads are validated through a Zod schema on both read and write.
 */

import fs from "node:fs";
import path from "node:path";
import lockfile from "proper-lockfile";
import type { z, ZodTypeAny } from "zod";

export interface AtomicJsonOptions {
  /** proper-lockfile retry count (default 5). */
  lockRetries?: number;
  /** Pretty-print indent for serialized JSON (default 2). */
  indent?: number;
}

function ensureFile(filePath: string, fallbackBody: string): void {
  if (fs.existsSync(filePath)) return;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, fallbackBody, "utf8");
}

function atomicWrite(filePath: string, body: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  fs.writeFileSync(tmp, body, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Read + Zod-validate a JSON file. Returns `fallback` if missing or invalid.
 * Schema-parse failures are logged but never throw, so callers can treat the
 * file as "corrupt, start fresh" without wrapping in try/catch.
 */
export function readJsonSync<S extends ZodTypeAny>(
  filePath: string,
  schema: S,
  fallback: z.infer<S>,
): z.infer<S> {
  if (!fs.existsSync(filePath)) return fallback;
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return schema.parse(JSON.parse(raw)) as z.infer<S>;
  } catch (err) {
    console.warn(`[atomic-json] parse failed for ${filePath}:`, err);
    return fallback;
  }
}

/** Read-modify-write under a `proper-lockfile` advisory lock. */
export async function updateJson<S extends ZodTypeAny>(
  filePath: string,
  schema: S,
  fallback: z.infer<S>,
  mutator: (current: z.infer<S>) => z.infer<S> | Promise<z.infer<S>>,
  opts?: AtomicJsonOptions,
): Promise<z.infer<S>> {
  const indent = opts?.indent ?? 2;
  ensureFile(filePath, JSON.stringify(fallback, null, indent));

  const release = await lockfile.lock(filePath, {
    retries: {
      retries: opts?.lockRetries ?? 50,
      minTimeout: 20,
      maxTimeout: 250,
      factor: 1.5,
      randomize: true,
    },
    realpath: false,
  });
  try {
    const current = readJsonSync(filePath, schema, fallback);
    const next = await mutator(current);
    const validated = schema.parse(next) as z.infer<S>;
    atomicWrite(filePath, JSON.stringify(validated, null, indent));
    return validated;
  } finally {
    await release();
  }
}

/** Atomic write of a fully-formed value (locks, validates, replaces). */
export async function writeJson<S extends ZodTypeAny>(
  filePath: string,
  schema: S,
  data: z.infer<S>,
  opts?: AtomicJsonOptions,
): Promise<void> {
  await updateJson(filePath, schema, data, () => data, opts);
}

/**
 * Write a raw, pre-serialized JSON string under the same atomic+lock guarantees.
 * Useful for hydration paths where the canonical bytes come from a remote and
 * we want to preserve them verbatim. The body is still schema-validated.
 */
export async function writeRawJson<S extends ZodTypeAny>(
  filePath: string,
  schema: S,
  body: string,
  opts?: AtomicJsonOptions,
): Promise<void> {
  const indent = opts?.indent ?? 2;
  ensureFile(filePath, JSON.stringify(schema.parse(JSON.parse(body)) as unknown, null, indent));

  const release = await lockfile.lock(filePath, {
    retries: {
      retries: opts?.lockRetries ?? 50,
      minTimeout: 20,
      maxTimeout: 250,
      factor: 1.5,
      randomize: true,
    },
    realpath: false,
  });
  try {
    schema.parse(JSON.parse(body));
    atomicWrite(filePath, body);
  } finally {
    await release();
  }
}
