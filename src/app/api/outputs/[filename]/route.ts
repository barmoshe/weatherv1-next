import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { getRuntimePaths } from "@/server/runtime/paths";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const { outputsDir } = getRuntimePaths();
  // Prevent directory traversal
  const safe = path.basename(filename);
  const filePath = path.join(outputsDir, safe);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = fs.readFileSync(filePath);
  const ext = path.extname(safe).toLowerCase();
  const contentType =
    ext === ".mp4" ? "video/mp4" :
    ext === ".json" ? "application/json" :
    "application/octet-stream";

  return new NextResponse(data, {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Accept-Ranges": "bytes",
    },
  });
}
