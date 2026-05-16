import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import {
  isDesktopMode,
  isDesktopRequestAuthorized,
  isEditorSessionAuthorized,
} from "@/server/runtime/auth";

// Auth bootstrap routes — these must respond even without an editor
// session cookie, since they're how the renderer establishes one.
const AUTH_BOOTSTRAP = new Set<string>([
  "/api/auth/editor-login",
  "/api/auth/sign-out",
  "/api/auth/me",
]);

// Infra routes that are gated by the desktop-token perimeter, not by
// the editor cookie. `/api/internal/health` is the readiness probe
// `electron/server-manager.cjs` polls before opening the window — it
// runs before any editor has logged in, so requiring a cookie would
// deadlock the launch.
function isEditorExempt(pathname: string): boolean {
  if (AUTH_BOOTSTRAP.has(pathname)) return true;
  if (pathname.startsWith("/api/internal/")) return true;
  return false;
}

export function proxy(request: NextRequest): NextResponse {
  // Desktop perimeter check first — the loopback gate.
  if (isDesktopMode() && !isDesktopRequestAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized desktop request" },
      { status: 401 },
    );
  }

  // Editor session check — required in both web and desktop modes for
  // /api/* (excluding auth bootstrap + infra probes) plus the /outputs
  // and /videos asset paths, which would otherwise leak rendered media.
  const { pathname } = request.nextUrl;
  if (!isEditorExempt(pathname) && !isEditorSessionAuthorized(request)) {
    return NextResponse.json(
      { success: false, error: "Unauthorized editor session" },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*", "/outputs/:path*", "/videos/:path*"],
};
