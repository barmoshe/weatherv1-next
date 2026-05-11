import { NextResponse } from "next/server";
import { SCENE_AWARE_SYSTEM_PROMPT } from "@/server/pipeline/picker";
import { DEFAULT_SCENE_PROMPT } from "@/server/pipeline/scene-planner";

export async function GET() {
  return NextResponse.json({
    success: true,
    default_prompt: SCENE_AWARE_SYSTEM_PROMPT,
    scene_planner_prompt: DEFAULT_SCENE_PROMPT,
  });
}
