import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { VIDEOS_DIR } from "@/server/catalog/storage";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  const safe = path.basename(filename);
  const filePath = path.join(VIDEOS_DIR, safe);

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const data = fs.readFileSync(filePath);
  return new NextResponse(data, {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(data.length),
      "Accept-Ranges": "bytes",
    },
  });
}
