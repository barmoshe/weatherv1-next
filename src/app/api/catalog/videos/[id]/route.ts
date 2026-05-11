import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { readCatalog, writeCatalog, VIDEOS_DIR, invalidateCatalogCache } from "@/server/catalog/storage";
import { isValidSource, SOURCE_VALUES } from "@/server/tag-vocab";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: vidId } = await params;
  const data = (await req.json()) as Record<string, unknown>;

  try {
    const catalog = readCatalog();
    const entry = catalog.videos.find((v) => v.id === vidId);
    if (!entry) {
      return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
    }

    if (data.description != null) {
      entry.description = String(data.description);
    }

    if (typeof data.tags === "object" && data.tags !== null) {
      const t = data.tags as Record<string, unknown>;
      const merged = { main: "", secondary: "", third: "", ...(entry.tags ?? {}) };
      for (const field of ["main", "secondary", "third"] as const) {
        if (field in t) {
          const v = t[field];
          merged[field] = v == null || v === "" ? "" : String(v).trim();
        }
      }
      entry.tags = merged;
    }

    if ("source" in data) {
      const src = data.source == null || data.source === "" ? null : String(data.source).trim();
      if (!isValidSource(src)) {
        return NextResponse.json(
          { success: false, error: `unknown source value: ${src}`, field: "source", suggestions: SOURCE_VALUES },
          { status: 400 }
        );
      }
      entry.source = (src ?? "original") as typeof entry.source;
    }

    if (Array.isArray(data.segments)) {
      const existingById = new Map(
        (entry.segments ?? []).filter((s) => s.id).map((s) => [s.id!, s])
      );
      entry.segments = [];
      for (const raw of data.segments as Record<string, unknown>[]) {
        if (typeof raw !== "object" || !raw) continue;
        const segId = String(raw.id ?? "").trim();
        if (!segId) continue;
        const base = existingById.get(segId) ?? {};
        const start = parseFloat(String(raw.start_sec ?? (base as any).start_sec ?? 0)) || 0;
        const end = parseFloat(String(raw.end_sec ?? (base as any).end_sec ?? 0)) || 0;
        let tags = raw.tags ?? (base as any).tags ?? [];
        if (!Array.isArray(tags)) tags = tags ? [tags] : [];
        const tagList = (tags as unknown[]).map((t) => String(t).trim()).filter(Boolean);
        const desc = String(raw.description ?? (base as any).description ?? "").trim();
        const conf = Math.min(1, Math.max(0, parseFloat(String(raw.confidence ?? (base as any).confidence ?? 0)) || 0));
        entry.segments.push({
          id: segId,
          start_sec: Math.round(start * 100) / 100,
          end_sec: Math.round(end * 100) / 100,
          description: desc,
          tags: tagList,
          confidence: conf,
        });
      }
    }

    await writeCatalog(catalog);
    invalidateCatalogCache();
    return NextResponse.json({ success: true, video: entry });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: vidId } = await params;
  const deleteFile = req.nextUrl.searchParams.get("delete_file") === "1";

  try {
    const catalog = readCatalog();
    const entry = catalog.videos.find((v) => v.id === vidId);
    if (!entry) {
      return NextResponse.json({ success: false, error: "Video not found" }, { status: 404 });
    }

    if (deleteFile && entry.filename) {
      const filePath = path.join(VIDEOS_DIR, entry.filename);
      try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    }

    catalog.videos = catalog.videos.filter((v) => v.id !== vidId);
    await writeCatalog(catalog);
    invalidateCatalogCache();
    return NextResponse.json({ success: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
