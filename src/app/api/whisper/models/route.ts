// Whisper model management.
//
// GET    → list available + installed models (sizes, descriptions, install state).
// POST   → start a download. Streams progress as Server-Sent Events so the
//          renderer can show a real progress bar without polling.
// DELETE → remove an installed model.
//
// All endpoints sit behind `assertDesktopAuth` because they touch the
// workspace cache and can trigger multi-GB downloads.

import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import {
  WHISPER_MODELS,
  type WhisperModelId,
  type DownloadProgress,
  listInstalledModels,
  downloadModel,
  deleteModel,
  pickActiveModel,
  modelsCacheDir,
  isLocalWhisperPlatformSupported,
} from "@/server/whisper/models";

function isModelId(value: unknown): value is WhisperModelId {
  return typeof value === "string" && value in WHISPER_MODELS;
}

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const statuses = listInstalledModels();
  const active = pickActiveModel();

  const models = (Object.values(WHISPER_MODELS) as Array<typeof WHISPER_MODELS[WhisperModelId]>).map(
    (m) => {
      const status = statuses.find((s) => s.id === m.id);
      return {
        id: m.id,
        repo: m.repo,
        size_bytes: m.sizeBytes,
        description_he: m.descriptionHe,
        quality_he: m.qualityHe,
        installed: status?.installed ?? false,
        disk_bytes: status?.diskBytes ?? 0,
        verified: status?.verified ?? false,
        is_active: active?.id === m.id,
      };
    },
  );

  return NextResponse.json({
    success: true,
    models,
    cache_dir: modelsCacheDir(),
    active_model_id: active?.id ?? null,
  });
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  let body: { model_id?: unknown };
  try {
    body = (await req.json()) as { model_id?: unknown };
  } catch {
    return NextResponse.json({ success: false, error: "Invalid JSON" }, { status: 400 });
  }
  if (!isModelId(body.model_id)) {
    return NextResponse.json(
      { success: false, error: `Unknown model_id: ${String(body.model_id)}` },
      { status: 400 },
    );
  }
  if (!isLocalWhisperPlatformSupported()) {
    // Don't even attempt the download — `@huggingface/transformers` would
    // throw at import time on darwin/x64 because onnxruntime-node doesn't
    // ship a binding for that slot.
    return NextResponse.json(
      {
        success: false,
        error: `Local Whisper isn't supported on ${process.platform}/${process.arch} in this build.`,
      },
      { status: 409 },
    );
  }
  const modelId = body.model_id;

  // Server-Sent Events stream so the renderer renders a real progress bar.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: DownloadProgress) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await downloadModel(modelId, send);
        controller.enqueue(encoder.encode("event: done\ndata: {}\n\n"));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        controller.enqueue(
          encoder.encode(`event: error\ndata: ${JSON.stringify({ error: msg })}\n\n`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

export async function DELETE(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const modelId = url.searchParams.get("model_id");
  if (!isModelId(modelId)) {
    return NextResponse.json(
      { success: false, error: `Unknown model_id: ${modelId}` },
      { status: 400 },
    );
  }

  try {
    await deleteModel(modelId);
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
