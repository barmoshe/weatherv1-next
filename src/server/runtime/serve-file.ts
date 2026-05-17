import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";

const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".json": "application/json",
};

function mimeFor(ext: string): string {
  return MIME_BY_EXT[ext.toLowerCase()] ?? "application/octet-stream";
}

interface ServeRuntimeFileOptions {
  dir: string;
  filename: string;
  /** Raw `Range` header value (e.g. `req.headers.get("range")`), or null. */
  range?: string | null;
  cacheControl?: string;
}

/**
 * Serve a file from a runtime directory with byte-range support so the browser
 * `<audio>`/`<video>` element can seek. Returns 404 if the file is missing,
 * 416 for malformed/out-of-bounds ranges, 206 for partial responses, 200 otherwise.
 *
 * The filename is `path.basename`'d as a traversal guard — callers should
 * still scope by `dir` to their runtime root.
 */
export function serveRuntimeFile({
  dir,
  filename,
  range,
  cacheControl,
}: ServeRuntimeFileOptions): NextResponse {
  const safe = path.basename(filename);
  const filePath = path.join(dir, safe);

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const contentType = mimeFor(path.extname(safe));
  const size = stat.size;
  const baseHeaders: Record<string, string> = {
    "Content-Type": contentType,
    "Accept-Ranges": "bytes",
  };
  if (cacheControl) baseHeaders["Cache-Control"] = cacheControl;

  const parsed = range ? parseRange(range, size) : null;
  if (range && !parsed) {
    return new NextResponse(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${size}` },
    });
  }

  const start = parsed?.start ?? 0;
  const end = parsed?.end ?? size - 1;
  const length = end - start + 1;
  const stream = fs.createReadStream(filePath, { start, end });
  const body = Readable.toWeb(stream) as unknown as BodyInit;

  return new NextResponse(body, {
    status: parsed ? 206 : 200,
    headers: {
      ...baseHeaders,
      "Content-Length": String(length),
      ...(parsed ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
    },
  });
}

/** Parse a single-range `bytes=START-END` header. Returns null for unsupported forms. */
function parseRange(header: string, size: number): { start: number; end: number } | null {
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, rawStart, rawEnd] = m;
  let start: number;
  let end: number;
  if (rawStart === "" && rawEnd === "") return null;
  if (rawStart === "") {
    // suffix: bytes=-N → last N bytes
    const n = Number(rawEnd);
    if (!Number.isFinite(n) || n <= 0) return null;
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd === "" ? size - 1 : Number(rawEnd);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  if (start > end || start < 0 || end >= size) return null;
  return { start, end };
}
