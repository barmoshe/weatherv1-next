// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isEditorSessionAuthorized } from "@/server/runtime/auth";
import { resetRuntimeConfigForTests } from "@/server/runtime/config";

const ENV_KEYS = ["DESKTOP_MODE", "R2_SYNC_ENABLED"] as const;
let originalEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>;

function req(): NextRequest {
  return new NextRequest("http://localhost/api/jobs");
}

beforeEach(() => {
  originalEnv = {};
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetRuntimeConfigForTests();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetRuntimeConfigForTests();
});

describe("editor session in pure-local desktop mode", () => {
  it("trusts the desktop shell when sync is off (no cookie needed)", () => {
    process.env.DESKTOP_MODE = "1";
    resetRuntimeConfigForTests();
    expect(isEditorSessionAuthorized(req())).toBe(true);
  });

  it("keeps the gate in desktop cloud mode", () => {
    process.env.DESKTOP_MODE = "1";
    process.env.R2_SYNC_ENABLED = "1";
    resetRuntimeConfigForTests();
    expect(isEditorSessionAuthorized(req())).toBe(false);
  });

  it("keeps the gate in web mode regardless of sync", () => {
    resetRuntimeConfigForTests();
    expect(isEditorSessionAuthorized(req())).toBe(false);
  });
});
