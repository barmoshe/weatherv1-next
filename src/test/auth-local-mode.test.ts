// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isEditorSessionAuthorized } from "@/server/runtime/auth";
import { resetRuntimeConfigForTests } from "@/server/runtime/config";

const ENV_KEYS = [
  "DESKTOP_MODE",
  "R2_SYNC_ENABLED",
  "R2_GATEWAY_URL",
  "R2_TENANT_ID",
  "R2_APP_USERNAME",
  "EDITOR_PASSWORD",
] as const;
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

  it("keeps the gate in desktop cloud mode once the credential is in play", () => {
    process.env.DESKTOP_MODE = "1";
    process.env.R2_SYNC_ENABLED = "1";
    process.env.R2_GATEWAY_URL = "https://gw.example.workers.dev";
    process.env.R2_TENANT_ID = "default";
    process.env.R2_APP_USERNAME = "v1editor";
    process.env.EDITOR_PASSWORD = "pw";
    resetRuntimeConfigForTests();
    expect(isEditorSessionAuthorized(req())).toBe(false);
  });

  it("keeps trusting the shell when sync is enabled without credentials", () => {
    // The lockout case: a packaged user ticks the sync checkbox with no
    // username/password. The gate must not arm, or Settings (the only way
    // back) ends up behind a login the user never had.
    process.env.DESKTOP_MODE = "1";
    process.env.R2_SYNC_ENABLED = "1";
    resetRuntimeConfigForTests();
    expect(isEditorSessionAuthorized(req())).toBe(true);
  });

  it("keeps the gate in web mode regardless of sync", () => {
    resetRuntimeConfigForTests();
    expect(isEditorSessionAuthorized(req())).toBe(false);
  });
});
