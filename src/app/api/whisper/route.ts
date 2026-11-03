import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { resolveWhisperBinary } from "@/server/whisper/binary";
import { getModelStatus, startModelDownload } from "@/server/whisper/models";

// Local transcription model: GET reports state + download progress (polled by
// Settings), POST starts the one-time download of the Hebrew model + VAD.

function body() {
  return { success: true, ...getModelStatus(), binary_found: resolveWhisperBinary() !== null };
}

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  return NextResponse.json(body());
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;
  void startModelDownload().catch((err) => console.warn("[whisper] model download failed:", err));
  return NextResponse.json(body(), { status: 202 });
}
