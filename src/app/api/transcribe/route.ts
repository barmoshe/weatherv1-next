import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { transcribeAudio } from "@/server/pipeline/picker";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { upsertJob } from "@/server/jobs/store";

const UPLOADS_DIR = path.join(process.cwd(), "runtime", "uploads");

function openaiErrorResponse(err: unknown): [Record<string, unknown>, number] | null {
  const msg = err instanceof Error ? err.message : String(err);
  const quotaMarkers = ["insufficient_quota", "exceeded your current quota", "billing_hard_limit_reached"];
  if (quotaMarkers.some((m) => msg.includes(m))) {
    return [{ success: false, error: "אזל מאגר ה-OpenAI tokens. יש להוסיף קרדיט בחשבון ה-OpenAI.", error_code: "openai_quota_exceeded", console_url: "https://platform.openai.com/account/billing" }, 402];
  }
  if (msg.includes("invalid_api_key") || msg.includes("Incorrect API key")) {
    return [{ success: false, error: "מפתח OpenAI לא תקין.", error_code: "openai_invalid_key", console_url: "https://platform.openai.com/api-keys" }, 401];
  }
  return null;
}

export async function POST(req: NextRequest) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });

  const formData = await req.formData();
  const file = formData.get("audio");
  if (!file || typeof file === "string") {
    return NextResponse.json({ success: false, error: "No audio file provided" }, { status: 400 });
  }

  const fileName = (file as File).name || "audio.mp3";
  const ext = path.extname(fileName) || ".mp3";
  const savedName = `${uuidv4().replace(/-/g, "")}${ext}`;
  const savedPath = path.join(UPLOADS_DIR, savedName);

  const bytes = await (file as File).arrayBuffer();
  fs.writeFileSync(savedPath, Buffer.from(bytes));

  try {
    const { text, segments, duration } = await transcribeAudio(savedPath);

    const jobId = uuidv4().replace(/-/g, "");
    upsertJob({
      job_id: jobId,
      status: "draft",
      audio_filename: savedName,
      created_at: new Date().toISOString(),
    });

    updatePlanBundle(jobId, {
      created_at: new Date().toISOString(),
      audio_filename: savedName,
      duration_sec: duration,
      transcript: text,
      transcript_segments: segments,
    });

    return NextResponse.json({
      success: true,
      job_id: jobId,
      transcript: text,
      duration,
      filename: savedName,
      segments,
    });
  } catch (err) {
    const handled = openaiErrorResponse(err);
    if (handled) return NextResponse.json(handled[0], { status: handled[1] });
    console.error("[transcribe]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
