// POST /api/llm/check — checks the saved Claude key with one tiny request and
// says in Hebrew what is wrong with it, if anything. Settings calls it after a
// key is saved and from its "check key" button.

import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { checkAnthropicKey } from "@/server/providers/llm/check";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  const result = await checkAnthropicKey(process.env.ANTHROPIC_API_KEY);
  return NextResponse.json(result);
}
