// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const auth = vi.hoisted(() => ({
  desktopMode: false,
  desktopAuthorized: true,
  editorAuthorized: false,
}));

vi.mock("@/server/runtime/auth", () => ({
  isDesktopMode: () => auth.desktopMode,
  isDesktopRequestAuthorized: () => auth.desktopAuthorized,
  isEditorSessionAuthorized: () => auth.editorAuthorized,
}));

import { proxy } from "@/proxy";

function makeReq(pathname: string): NextRequest {
  return new NextRequest(`http://localhost${pathname}`);
}

beforeEach(() => {
  auth.desktopMode = false;
  auth.desktopAuthorized = true;
  auth.editorAuthorized = false;
});

describe("proxy middleware", () => {
  it("allows the three auth bootstrap routes without an editor cookie", () => {
    for (const p of [
      "/api/auth/editor-login",
      "/api/auth/sign-out",
      "/api/auth/me",
    ]) {
      const res = proxy(makeReq(p));
      // NextResponse.next() yields status 200 with no body
      expect(res.status).toBe(200);
    }
  });

  it("allows /api/internal/* without an editor cookie (server-manager health probe)", () => {
    const res = proxy(makeReq("/api/internal/health"));
    expect(res.status).toBe(200);
  });

  it("rejects an arbitrary /api/* request without an editor cookie", () => {
    const res = proxy(makeReq("/api/plan"));
    expect(res.status).toBe(401);
  });

  it("allows /api/* when the editor session is authorized", () => {
    auth.editorAuthorized = true;
    const res = proxy(makeReq("/api/plan"));
    expect(res.status).toBe(200);
  });

  it("rejects with the desktop error when desktop mode is unauthorized", async () => {
    auth.desktopMode = true;
    auth.desktopAuthorized = false;
    auth.editorAuthorized = true;
    const res = proxy(makeReq("/api/plan"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/desktop/);
  });

  it("gates /outputs/* and /videos/* behind the editor cookie too", () => {
    expect(proxy(makeReq("/outputs/job-1.mp4")).status).toBe(401);
    expect(proxy(makeReq("/videos/clip.mp4")).status).toBe(401);
    auth.editorAuthorized = true;
    expect(proxy(makeReq("/outputs/job-1.mp4")).status).toBe(200);
  });
});
