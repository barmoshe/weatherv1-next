import { NextRequest } from "next/server";
import { getRuntimePaths } from "@/server/runtime/paths";
import { serveRuntimeFile } from "@/server/runtime/serve-file";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;
  return serveRuntimeFile({
    dir: getRuntimePaths().outputsDir,
    filename,
    range: req.headers.get("range"),
  });
}
