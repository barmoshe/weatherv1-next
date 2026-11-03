// Browser build: serve a runtime file (render, narration, clip) from the
// library folder. Media elements get blob URLs (web/runtime/media-urls.ts),
// so whole-file responses are enough; ranges are not needed.
import path from "node:path";
import fs from "node:fs";
import { NextResponse } from "next/server";
import { readExternal } from "../../../runtime/vfs";

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".json": "application/json",
};

interface ServeRuntimeFileOptions {
  dir: string;
  filename: string;
  range?: string | null;
  cacheControl?: string;
}

export function serveRuntimeFile({ dir, filename, cacheControl }: ServeRuntimeFileOptions): NextResponse {
  const filePath = path.join(dir, path.basename(filename));
  if (!fs.existsSync(filePath)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const size = fs.statSync(filePath).size;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const reader = (await readExternal(filePath)).stream().getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new NextResponse(body, {
    headers: {
      "Content-Type": MIME_BY_EXT[path.extname(filePath).toLowerCase()] ?? "application/octet-stream",
      "Content-Length": String(size),
      ...(cacheControl ? { "Cache-Control": cacheControl } : {}),
    },
  });
}
