import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { isEditorSessionAuthorized } from "@/server/runtime/auth";
import { EDITOR_USERNAME } from "@/server/runtime/auth-passwords";

export async function GET(req: NextRequest) {
  return NextResponse.json({
    ok: isEditorSessionAuthorized(req),
    username: EDITOR_USERNAME,
  });
}
