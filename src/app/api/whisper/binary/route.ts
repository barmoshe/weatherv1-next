// Whisper.cpp binary management.
//
// GET    → report whether a binary is currently resolvable and whether the
//          current platform has a downloadable asset.
// POST   → download + install the pinned whisper.cpp release for this
//          platform. Streams progress as Server-Sent Events.
// DELETE → remove a previously-downloaded binary from the workspace cache.
//
// All endpoints sit behind `assertDesktopAuth` because they touch the
// workspace cache and shell out to network.

import { NextRequest, NextResponse } from "next/server";
import { assertDesktopAuth } from "@/server/runtime/auth";
import { resolveWhisperBinary } from "@/server/whisper/binary";
import {
  describeBinaryDownload,
  downloadWhisperBinary,
  removeWhisperBinary,
  type WhisperBinaryDownloadProgress,
} from "@/server/whisper/binary-download";

export async function GET(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const resolution = resolveWhisperBinary();
  const info = describeBinaryDownload();
  return NextResponse.json({
    success: true,
    installed: Boolean(resolution),
    binary: resolution
      ? { path: resolution.path, source: resolution.source }
      : { path: null, source: null },
    download: info,
  });
}

export async function POST(req: NextRequest) {
  const denied = assertDesktopAuth(req);
  if (denied) return denied;

  const info = describeBinaryDownload();
  if (!info.supported) {
    return NextResponse.json(
      {
        success: false,
        error: `No prebuilt whisper.cpp binary is available for ${info.platform}.`,
        platform: info.platform,
      },
      { status: 409 },
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (data: WhisperBinaryDownloadProgress) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };
      try {
        await downloadWhisperBinary(send);
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

  try {
    await removeWhisperBinary();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
