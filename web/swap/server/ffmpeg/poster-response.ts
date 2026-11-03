// Browser build: serve a cached poster from the library folder.
import fs from "node:fs";
import { NextResponse } from "next/server";
import { readExternal } from "../../../runtime/vfs";

export type PosterSource = "local-cache" | "ffmpeg-local" | "r2-cache";

export function posterResponse(filePath: string, source: PosterSource): NextResponse | null {
  if (!fs.existsSync(filePath)) return null;
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        controller.enqueue(new Uint8Array(await (await readExternal(filePath)).arrayBuffer()));
        controller.close();
      } catch (err) {
        controller.error(err);
      }
    },
  });
  return new NextResponse(body, {
    headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=3600", "X-Poster-Source": source },
  });
}
