import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import {
  EDITOR_COOKIE_NAME,
  readEditorSessionToken,
} from "@/server/runtime/auth";
import { revokeToken } from "@/server/runtime/editor-session";

export async function POST(req: NextRequest) {
  const token = readEditorSessionToken(req);
  if (token) revokeToken(token);
  const res = NextResponse.json({ success: true });
  res.cookies.delete(EDITOR_COOKIE_NAME);
  return res;
}
