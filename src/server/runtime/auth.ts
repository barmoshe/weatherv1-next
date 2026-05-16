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
  return isValidToken(readEditorSessionToken(req));
}

export function assertEditorSession(req: Pick<NextRequest, "cookies">): NextResponse | null {
  if (isEditorSessionAuthorized(req)) return null;
  return NextResponse.json(
    { success: false, error: "Unauthorized editor session" },
    { status: 401 },
  );
}
