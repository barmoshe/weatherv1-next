"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { desktop } from "@/client/lib/desktop";
import { useCatalog } from "@/client/hooks/useCatalog";
import type { ParsedVideo } from "@/shared/types";
import { CatalogFilters, type FilterState, type SortOrder } from "./CatalogFilters";
import { VideoGrid } from "./VideoGrid";
import { DetailModal } from "./DetailModal";

const DEFAULT_FILTERS: FilterState = {
  search: "",
  activeTags: [],
  activeSource: null,
  untaggedOnly: false,
  sort: "newest",
};

function hasAnySegmentTag(video: ParsedVideo): boolean {
  for (const seg of video.segments ?? []) {
    if ((seg.tags ?? []).some((t) => t)) return true;
  }
  // Also check legacy clip-level tags
  const lt = video.tags;
  if (!lt) return false;
  if (Array.isArray(lt)) return lt.some(Boolean);
  return Boolean(lt.main || lt.secondary || lt.third);
}

function videoMatchesTags(video: ParsedVideo, activeTags: string[]): boolean {
  if (activeTags.length === 0) return true;
  const allTags = new Set<string>();

  for (const seg of video.segments ?? []) {
    for (const t of seg.tags ?? []) {
      if (t) allTags.add(t);
    }
  }

  const lt = video.tags;
  if (lt) {
    if (Array.isArray(lt)) {
      (lt as string[]).forEach((t) => t && allTags.add(t));
    } else {
      [lt.main, lt.secondary, lt.third].forEach((t) => t && allTags.add(t));
    }
  }

  return activeTags.every((tag) => allTags.has(tag));
}

function sortVideos(videos: ParsedVideo[], sort: SortOrder): ParsedVideo[] {
  const arr = [...videos];
  switch (sort) {
    case "newest":
      return arr.sort((a, b) => {
        const da = a.added_at ?? a.id;
        const db = b.added_at ?? b.id;
        return db.localeCompare(da);
      });
    case "oldest":
      return arr.sort((a, b) => {
        const da = a.added_at ?? a.id;
        const db = b.added_at ?? b.id;
        return da.localeCompare(db);
      });
    case "duration_desc":
      return arr.sort((a, b) => (b.duration_sec ?? 0) - (a.duration_sec ?? 0));
    case "duration_asc":
      return arr.sort((a, b) => (a.duration_sec ?? 0) - (b.duration_sec ?? 0));
    case "name":
      return arr.sort((a, b) => a.filename.localeCompare(b.filename));
    default:
      return arr;
  }
}

export function CatalogPanel() {
  const qc = useQueryClient();
  const { data: videos = [], isLoading, isError, error } = useCatalog();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [selectedVideo, setSelectedVideo] = useState<ParsedVideo | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const patchFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  const filtered = useMemo(() => {
    let result = videos;

    // Text search: id, filename, description
    const q = filters.search.trim().toLowerCase();
    if (q) {
      result = result.filter(
        (v) =>
          v.id.toLowerCase().includes(q) ||
          v.filename.toLowerCase().includes(q) ||
          (v.description ?? "").toLowerCase().includes(q)
      );
    }

    // Tag filter (AND across selected tags)
    if (filters.activeTags.length > 0) {
      result = result.filter((v) => videoMatchesTags(v, filters.activeTags));
    }

    // Source filter
    if (filters.activeSource) {
      result = result.filter((v) => v.source === filters.activeSource);
    }

    // Untagged only
    if (filters.untaggedOnly) {
      result = result.filter((v) => !hasAnySegmentTag(v));
    }

    return sortVideos(result, filters.sort);
  }, [videos, filters]);

  const handleVideoClick = useCallback((video: ParsedVideo) => {
    setSelectedVideo(video);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedVideo(null);
  }, []);

  const completeImport = useCallback(async (res: Response) => {
    const data = await res.json() as { success: boolean; error?: string };
    if (!res.ok || !data.success) {
      throw new Error(data.error ?? `HTTP ${res.status}`);
    }
    await qc.invalidateQueries({ queryKey: ["catalog"] });
    await qc.invalidateQueries({ queryKey: ["tag-counts"] });
  }, [qc]);

  const handleImportClick = useCallback(async () => {
    setImportError(null);
    if (!desktop) {
      fileInputRef.current?.click();
      return;
    }

    const picked = await desktop.importCatalogVideo();
    if (!picked) return;

    setImporting(true);
    try {
      const nameWithoutExt = picked.name.replace(/\.[^.]+$/, "");
      const res = await fetch("/api/catalog/videos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          desktop_file_path: picked.path,
          metadata: {
            description: nameWithoutExt,
            source: "original",
            tags: {},
          },
        }),
      });
      await completeImport(res);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [completeImport]);

  const handleBrowserVideoChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setImportError(null);
    setImporting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("metadata", JSON.stringify({
        description: file.name.replace(/\.[^.]+$/, ""),
        source: "original",
        tags: {},
      }));
      const res = await fetch("/api/catalog/videos", { method: "POST", body: fd });
      await completeImport(res);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
    }
  }, [completeImport]);

  return (
    <section
      className="tab-panel"
      id="panel-catalog"
      role="tabpanel"
      aria-labelledby="tab-catalog"
      data-tab-panel="catalog"
    >
      {isError && (
        <div className="error-banner" role="alert">
          שגיאה בטעינת הקטלוג:{" "}
          {error instanceof Error ? error.message : "שגיאה לא ידועה"}
        </div>
      )}

      <header className="catalog-bar">
        <div className="catalog-bar-left">
          <h2 className="catalog-title">קטלוג קליפים</h2>
          <span className="catalog-progress" id="catalog-progress">
            {isLoading ? "טוען…" : `${filtered.length} מתוך ${videos.length}`}
          </span>
        </div>
        <div className="catalog-bar-right">
          <input
            type="search"
            id="catalog-search"
            className="catalog-search"
            placeholder="חפש בקטלוג…"
            aria-label="חיפוש"
            value={filters.search}
            onChange={(e) => patchFilters({ search: e.target.value })}
          />
          <select
            id="catalog-sort"
            className="catalog-sort"
            aria-label="מיון"
            value={filters.sort}
            onChange={(e) => patchFilters({ sort: e.target.value as typeof filters.sort })}
          >
            <optgroup label="זמן">
              <option value="newest">נוסף לאחרונה</option>
              <option value="oldest">נוסף ראשון</option>
            </optgroup>
            <optgroup label="משך">
              <option value="duration_desc">ארוך לקצר</option>
              <option value="duration_asc">קצר לארוך</option>
            </optgroup>
            <optgroup label="אחר">
              <option value="name">מזהה (א-ת)</option>
            </optgroup>
          </select>
          <button
            type="button"
            className="btn"
            id="add-video-btn"
            disabled={importing}
            onClick={handleImportClick}
          >
            <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ marginInlineEnd: "0.3rem", verticalAlign: "-2px" }}>
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
            {importing ? "מעלה…" : "העלה וידאו"}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/mp4,video/quicktime,.mp4,.mov"
            hidden
            onChange={handleBrowserVideoChange}
          />
        </div>
      </header>

      {importError && (
        <div className="error-banner" role="alert">
          שגיאה בייבוא וידאו: {importError}
        </div>
      )}

      <div className="catalog-layout">
        <CatalogFilters
          filters={filters}
          onChange={patchFilters}
          totalCount={videos.length}
          filteredCount={filtered.length}
        />

        <div className="catalog-main">
          <div className="active-filters" id="active-filters" hidden />
          <div className="grid-summary" id="grid-summary" hidden />
          <div className="sr-only" role="status" aria-live="polite" id="grid-announce" />
          {isLoading ? (
            <div className="catalog-grid" id="catalog-grid">
              <div className="catalog-loading">טוען קטלוג…</div>
            </div>
          ) : (
            <VideoGrid
              videos={filtered}
              onVideoClick={handleVideoClick}
            />
          )}
        </div>
      </div>

      {selectedVideo && (
        <DetailModal video={selectedVideo} onClose={handleModalClose} />
      )}
    </section>
  );
}
