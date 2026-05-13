import { getR2Stream, r2Configured, tenantKey } from "@/server/sync/r2/client";

async function main() {
  if (!r2Configured()) {
    console.error("R2 not configured");
    process.exit(2);
  }
  const segId = process.argv[2] ?? "IB001-s0";
  const key = tenantKey(`posters/segments/${segId}.jpg`);
  console.log("GET", key);
  const result = await getR2Stream(key);
  if (!result) {
    console.log("not found");
    process.exit(1);
  }
  console.log("content-type:", result.contentType);
  console.log("content-length:", result.contentLength);
  console.log("etag:", result.etag);
  let total = 0;
  const reader = result.body.getReader();
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value?.length ?? 0;
  }
  console.log("bytes read:", total);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
