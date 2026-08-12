import fs from "node:fs";
import { NextResponse } from "next/server";

export type PosterSource = "local-cache" | "ffmpeg-local" | "r2-cache";

/** Serve a poster JPEG from disk, or null when the file does not exist. */
export function posterResponse(filePath: string, source: PosterSource): NextResponse | null {
  if (!fs.existsSync(filePath)) return null;
  const buf = fs.readFileSync(filePath);
  return new NextResponse(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
      "X-Poster-Source": source,
    },
  });
}
