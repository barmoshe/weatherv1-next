import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { isDesktopMode, isDesktopRequestAuthorized } from "@/server/runtime/auth";

export function proxy(request: NextRequest): NextResponse {
  if (!isDesktopMode()) return NextResponse.next();
  if (isDesktopRequestAuthorized(request)) return NextResponse.next();
  return NextResponse.json(
    { success: false, error: "Unauthorized desktop request" },
    { status: 401 },
  );
}

export const config = {
  matcher: ["/api/:path*", "/outputs/:path*", "/videos/:path*"],
};
