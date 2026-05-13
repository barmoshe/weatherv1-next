import { NextResponse } from "next/server";
import { getR2Text, headR2Object, r2Configured, tenantKey } from "@/server/sync/r2/client";

/**
 * Snapshot of `tenants/<tenant>/jobs/jobs.json` in R2 (mirrored from the local store).
 */
export async function GET() {
  if (!r2Configured()) {
    return NextResponse.json(
      { success: false, error: "r2_not_configured" },
      { status: 503 },
    );
  }

  const objectKey = tenantKey("jobs/jobs.json");

  try {
    const head = await headR2Object(objectKey);
    if (!head) {
      const now = new Date().toISOString();
      return NextResponse.json({
        success: true,
        source: "r2",
        objectKey,
        updatedAt: undefined,
        etag: undefined,
        jobs: {},
        exportedAt: now,
      });
    }

    const { text, etag } = await getR2Text(objectKey);
    let jobs: Record<string, unknown>;
    try {
      jobs = JSON.parse(text) as Record<string, unknown>;
      if (jobs === null || typeof jobs !== "object" || Array.isArray(jobs)) {
        return NextResponse.json(
          { success: false, error: "r2_jobs_invalid_shape" },
          { status: 502 },
        );
      }
    } catch {
      return NextResponse.json({ success: false, error: "r2_jobs_invalid_json" }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      source: "r2",
      objectKey,
      updatedAt: head.updatedAt,
      etag: etag ?? head.etag,
      jobs,
      exportedAt: new Date().toISOString(),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ success: false, error: "r2_fetch_failed", detail: msg }, { status: 502 });
  }
}
