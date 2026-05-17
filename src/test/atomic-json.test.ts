// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { readJsonSync, updateJson, writeJson } from "@/server/runtime/atomic-json";

const CounterSchema = z.object({ value: z.number().int().nonnegative() });

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "weatherv1-atomic-json-"));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("atomic-json", () => {
  it("readJsonSync returns fallback when file is missing", () => {
    const p = path.join(tempDir, "missing.json");
    expect(readJsonSync(p, CounterSchema, { value: 0 })).toEqual({ value: 0 });
  });

  it("readJsonSync returns fallback when payload fails schema", async () => {
    const p = path.join(tempDir, "corrupt.json");
    fs.writeFileSync(p, '{"value": "not-a-number"}');
    expect(readJsonSync(p, CounterSchema, { value: 0 })).toEqual({ value: 0 });
  });

  it("writeJson + readJsonSync round-trip", async () => {
    const p = path.join(tempDir, "round-trip.json");
    await writeJson(p, CounterSchema, { value: 7 });
    expect(readJsonSync(p, CounterSchema, { value: 0 })).toEqual({ value: 7 });
  });

  it("concurrent updateJson calls do not lose updates", async () => {
    const p = path.join(tempDir, "counter.json");
    await writeJson(p, CounterSchema, { value: 0 });

    const N = 50;
    await Promise.all(
      Array.from({ length: N }, () =>
        updateJson(p, CounterSchema, { value: 0 }, (cur) => ({ value: cur.value + 1 })),
      ),
    );

    expect(readJsonSync(p, CounterSchema, { value: 0 })).toEqual({ value: N });
  });

  it("rejects writes that fail schema validation", async () => {
    const p = path.join(tempDir, "invalid.json");
    await expect(
      writeJson(p, CounterSchema, { value: -1 } as unknown as z.infer<typeof CounterSchema>),
    ).rejects.toThrow();
  });
});
