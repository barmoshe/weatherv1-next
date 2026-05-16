import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { verifyEditorLogin } from "@/server/runtime/auth-passwords";
import { EDITOR_COOKIE_NAME } from "@/server/runtime/auth";
import { issueToken } from "@/server/runtime/editor-session";

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function POST(req: NextRequest) {
  let body: { username?: unknown; password?: unknown };
  try {
    body = (await req.json()) as { username?: unknown; password?: unknown };
  } catch {
    return NextResponse.json(
      { success: false, error: "Invalid request body" },
      { status: 400 },
    );
  }

  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!username || !password) {
    // Same 200 + success:false shape as a credential miss to avoid
    // shape-based enumeration of "missing field" vs "wrong password".
    return NextResponse.json({ success: false, error: "Invalid credentials" });
  }

  const ok = await verifyEditorLogin(username, password);
  if (!ok) {
    return NextResponse.json({ success: false, error: "Invalid credentials" });
  }

  const token = issueToken();
  const res = NextResponse.json({ success: true, token });
  res.cookies.set(EDITOR_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // Desktop mode is always HTTP loopback (127.0.0.1); marking the
    // cookie Secure there makes Chromium silently drop it. Web prod
    // must sit behind HTTPS, so Secure is correct there.
    secure: process.env.NODE_ENV === "production" && process.env.DESKTOP_MODE !== "1",
    path: "/",
    maxAge: ONE_YEAR_SECONDS,
  });
  return res;
}
