import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { transcribeAudio } from "@/server/pipeline/picker";
import { updatePlanBundle } from "@/server/jobs/plan-bundle";
import { upsertJob } from "@/server/jobs/store";
import { persistTranscriptionUsageEstimate } from "@/server/jobs/usage-persist";
import { getRuntimePaths } from "@/server/runtime/paths";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { mapProviderError } from "@/server/providers/errors";
import { uploadRuntimeFile } from "@/server/sync/r2/service";

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const { uploadsDir } = getRuntimePaths();
  fs.mkdirSync(uploadsDir, { recursive: true });
  const contentType = req.headers.get("content-type") ?? "";

  let savedName = "";
  let savedPath = "";

  if (contentType.includes("application/json")) {
    const data = (await req.json()) as { desktop_file_path?: string };
    const desktopFilePath = data.desktop_file_path?.trim();
    if (!desktopFilePath) {
      return NextResponse.json({ success: false, error: "No audio file provided" }, { status: 400 });
    }
    const ext = path.extname(desktopFilePath) || ".mp3";
    savedName = `${uuidv4().replace(/-/g, "")}${ext}`;
    savedPath = path.join(uploadsDir, savedName);
    fs.copyFileSync(desktopFilePath, savedPath);
  } else {
    const formData = await req.formData();
    const file = formData.get("audio");
    if (!file || typeof file === "string") {
      return NextResponse.json({ success: false, error: "No audio file provided" }, { status: 400 });
    }

    const fileName = (file as File).name || "audio.mp3";
    const ext = path.extname(fileName) || ".mp3";
    savedName = `${uuidv4().replace(/-/g, "")}${ext}`;
    savedPath = path.join(uploadsDir, savedName);

    const bytes = await (file as File).arrayBuffer();
    fs.writeFileSync(savedPath, Buffer.from(bytes));
  }

  try {
    const {
      text,
      segments,
      duration,
      transcription_model,
      billed_audio_sec,
    } = await transcribeAudio(savedPath);

    const jobId = uuidv4().replace(/-/g, "");
    upsertJob({
      job_id: jobId,
      status: "draft",
      audio_filename: savedName,
      created_at: new Date().toISOString(),
    });

    persistTranscriptionUsageEstimate(jobId, {
      billed_audio_sec,
      transcription_model,
    });

    updatePlanBundle(jobId, {
      created_at: new Date().toISOString(),
      audio_filename: savedName,
      duration_sec: duration,
      transcript: text,
      transcript_segments: segments,
    });

    void uploadRuntimeFile(`voiceovers/${jobId}/${savedName}`, savedPath).catch((e) => {
      console.warn(`R2 voiceover upload failed for ${jobId}:`, e);
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
    const handled = mapProviderError(err);
    if (handled) return NextResponse.json(handled.body, { status: handled.status });
    console.error("[transcribe]", err);
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
