import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getRuntimeConfig } from "./config";

export const DESKTOP_AUTH_HEADER = "x-weather-desktop-token";

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
