"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { desktop } from "@/client/lib/desktop";
import { useCatalog, useR2SyncStatus } from "@/client/hooks/useCatalog";
import type { ParsedVideo } from "@/shared/types";
import { CatalogFilters, type FilterState, type SortOrder } from "./CatalogFilters";
import { VideoGrid } from "./VideoGrid";
import { DetailModal } from "./DetailModal";

const DEFAULT_FILTERS: FilterState = {
  search: "",
  activeTags: [],
  activeSource: null,
  untaggedOnly: false,
  multiSegmentOnly: false,
  sort: "newest",
};

function CatalogSkeleton() {
  return (
    <div className="catalog-grid catalog-grid--skeleton" aria-hidden="true">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="video-card video-card--skeleton">
          <div className="video-thumb skeleton-block" />
          <div className="video-card-body">
            <span className="skeleton-line" />
            <span className="skeleton-line skeleton-line--short" />
          </div>
        </div>
      ))}
    </div>
  );
}

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
  const { data: r2Status } = useR2SyncStatus();
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [searchText, setSearchText] = useState(DEFAULT_FILTERS.search);
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [selectedVideo, setSelectedVideo] = useState<ParsedVideo | null>(null);
  const [importing, setImporting] = useState(false);
  const [materializingId, setMaterializingId] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const patchFilters = useCallback((patch: Partial<FilterState>) => {
    setFilters((prev) => ({ ...prev, ...patch }));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => patchFilters({ search: searchText }), 180);
    return () => window.clearTimeout(timer);
  }, [patchFilters, searchText]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = document.activeElement?.tagName;
      if (e.key === "/" && tag !== "INPUT" && tag !== "TEXTAREA") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
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

    // Videos with 2+ catalog segments only
    if (filters.multiSegmentOnly) {
      result = result.filter((v) => (v.segments?.length ?? 0) >= 2);
    }

    return sortVideos(result, filters.sort);
  }, [videos, filters]);

  const multiSegmentCount = useMemo(
    () => videos.filter((v) => (v.segments?.length ?? 0) >= 2).length,
    [videos]
  );

  const handleVideoClick = useCallback((video: ParsedVideo) => {
    setSelectedVideo(video);
  }, []);

  const handleModalClose = useCallback(() => {
    setSelectedVideo(null);
  }, []);

  const handleMaterialize = useCallback(async (video: ParsedVideo) => {
    setMaterializingId(video.id);
    setImportError(null);
    try {
      const res = await fetch("/api/sync/r2/materialize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ video_id: video.id }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!res.ok || !data.success) throw new Error(data.error ?? `HTTP ${res.status}`);
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      await qc.invalidateQueries({ queryKey: ["r2-sync-status"] });
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setMaterializingId(null);
    }
  }, [qc]);

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
            {isLoading
              ? "טוען…"
              : r2Status?.enabled
                ? `${filtered.length} מתוך ${videos.length} · מקומי ${r2Status.counts.local} · בענן ${r2Status.counts.cloudOnly}`
                : `${filtered.length} מתוך ${videos.length}`}
          </span>
        </div>
        <div className="catalog-bar-right">
          <input
            ref={searchInputRef}
            type="search"
            id="catalog-search"
            className="catalog-search"
            placeholder="חפש בקטלוג…"
            aria-label="חיפוש"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
          <div className="catalog-view-toggle" role="group" aria-label="תצוגה">
            <button type="button" className={viewMode === "grid" ? "is-active" : ""} onClick={() => setViewMode("grid")}>רשת</button>
            <button type="button" className={viewMode === "list" ? "is-active" : ""} onClick={() => setViewMode("list")}>רשימה</button>
          </div>
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
          multiSegmentCount={multiSegmentCount}
        />

        <div className="catalog-main">
          {r2Status?.enabled && (
            <div className={`catalog-sync-strip${r2Status.conflict ? " is-conflict" : ""}${r2Status.error ? " is-error" : ""}`}>
              {r2Status.conflict
                ? "הקטלוג המרוחק השתנה"
                : r2Status.error
                  ? r2Status.error
                  : r2Status.counts.syncing > 0
                    ? `מסנכרן ${r2Status.counts.syncing} קבצים`
                    : r2Status.ready
                      ? "כל הקבצים מסונכרנים"
                      : "R2 לא מחובר"}
              {materializingId && <span> · מוריד {materializingId}</span>}
            </div>
          )}
          <div className="active-filters" id="active-filters" hidden />
          <div className="grid-summary" id="grid-summary" hidden />
          <div className="sr-only" role="status" aria-live="polite" id="grid-announce" />
          {isLoading ? (
            <CatalogSkeleton />
          ) : (
            <VideoGrid
              videos={filtered}
              onVideoClick={handleVideoClick}
              onMaterialize={handleMaterialize}
              viewMode={viewMode}
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
