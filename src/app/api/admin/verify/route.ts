import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { verifyAdminPassword } from "@/server/runtime/auth-passwords";

export async function POST(req: NextRequest) {
  let body: { password?: unknown };
  try {
    body = (await req.json()) as { password?: unknown };
  } catch {
    return NextResponse.json({ ok: false });
  }

  const password = typeof body.password === "string" ? body.password : "";
  if (!password) return NextResponse.json({ ok: false });

  const ok = await verifyAdminPassword(password);
  // Always 200; the boolean shape is the only signal. Avoids
  // status-code enumeration that would distinguish "wrong password"
  // from "missing field".
  return NextResponse.json({ ok });
}
