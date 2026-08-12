import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRuntimeConfig } from "./config";
import { isValidToken } from "./editor-session";

export const DESKTOP_AUTH_HEADER = "x-weather-desktop-token";
export const EDITOR_COOKIE_NAME = "weather_editor_session";

function constantTimeEqual(actual: string | null, expected: string | null): boolean {
  if (!actual || !expected) return false;
  const actualBuf = Buffer.from(actual);
  const expectedBuf = Buffer.from(expected);
  if (actualBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(actualBuf, expectedBuf);
}

export function isDesktopMode(): boolean {
  return getRuntimeConfig().desktopMode;
}

export function isDesktopRequestAuthorized(req: Pick<NextRequest, "headers">): boolean {
  const { desktopMode, desktopSessionToken } = getRuntimeConfig();
  if (!desktopMode) return true;
  return constantTimeEqual(req.headers.get(DESKTOP_AUTH_HEADER), desktopSessionToken);
}

export function assertDesktopAuth(req: Pick<NextRequest, "headers">): NextResponse | null {
  if (isDesktopRequestAuthorized(req)) return null;
  return NextResponse.json(
    { success: false, error: "Unauthorized desktop request" },
    { status: 401 },
  );
}

export function readEditorSessionToken(req: Pick<NextRequest, "cookies">): string | null {
  return req.cookies.get(EDITOR_COOKIE_NAME)?.value ?? null;
}

export function isEditorSessionAuthorized(req: Pick<NextRequest, "cookies">): boolean {
  // Desktop mode trusts the shell until cloud sync is FULLY configured: the
  // editor login exists to capture the cloud credential, so it only arms once
  // that credential is in play. Keying on `enabled` alone would hard-lock a
  // packaged user who ticks the sync checkbox without credentials — the gate
  // wraps the Settings screen that could undo it. (Inlined instead of
  // r2Configured() so the proxy middleware doesn't import the sync client.)
  const { desktopMode, r2 } = getRuntimeConfig();
  const r2CredentialInPlay = Boolean(
    r2.enabled && r2.gatewayUrl && r2.tenantId && r2.appUsername && r2.appPassword,
  );
  if (desktopMode && !r2CredentialInPlay) return true;
  return isValidToken(readEditorSessionToken(req));
}

export function assertEditorSession(req: Pick<NextRequest, "cookies">): NextResponse | null {
  if (isEditorSessionAuthorized(req)) return null;
  return NextResponse.json(
    { success: false, error: "Unauthorized editor session" },
    { status: 401 },
  );
}
