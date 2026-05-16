import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isEditorSessionAuthorized } from "@/server/runtime/auth";

export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: isEditorSessionAuthorized(req) });
}
