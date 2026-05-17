"use client";

import { useEffect, useMemo, useState } from "react";
import type { NormalisedSegment, ParsedVideo, Scene, TimelinePick } from "@/shared/types";
import { useCatalog } from "@/client/hooks/useCatalog";
import { segmentTimeRange } from "@/client/lib/catalog-display";
import { labelFor } from "@/client/lib/tag-labels";
import { formatTime } from "@/client/lib/format-time";

interface FlatSegment {
  video: ParsedVideo;
  segment: NormalisedSegment;
}

interface RankedSegment extends FlatSegment {
  score: number;
}

export type PickerMode = "scene-fill" | "pick-swap";

interface CatalogPickerModalProps {
  scene: Scene;
  jobId: string;
  scenes: Scene[];
  timeline: Record<string, unknown>[];
  mode: PickerMode;
  pickIndex?: number;
  pick?: Record<string, unknown>;
  excludeSegmentIds?: string[];
  onClose: () => void;
  onCommitted: (data: { timeline: TimelinePick[]; validator: Record<string, unknown> }) => void;
}

function tokenize(value: string | undefined | null): string[] {
  if (!value) return [];
  return String(value).toLowerCase().split(/[\s,/]+/).filter(Boolean);
}

function rankForScene(items: FlatSegment[], scene: Scene): RankedSegment[] {
  const keywords = new Set((scene.keywords ?? []).map((k) => String(k).toLowerCase()));
  const mood = scene.mood ? String(scene.mood).toLowerCase() : null;

  const ranked: RankedSegment[] = items.map(({ video, segment }) => {
    let score = 0;
    const segTags = (segment.tags ?? []).map((t) => String(t).toLowerCase());
    const sceneFit = (segment.concepts?.scene_fit ?? []).map((t) => String(t).toLowerCase());
    const seasonMood = (segment.concepts?.season_mood ?? []).map((t) => String(t).toLowerCase());
    const videoTags = [
      video.tags?.main ?? "",
      video.tags?.secondary ?? "",
      video.tags?.third ?? "",
    ].map((t) => String(t).toLowerCase()).filter(Boolean);

    for (const t of segTags) if (keywords.has(t)) score += 3;
    for (const t of sceneFit) if (keywords.has(t)) score += 2;
    for (const t of videoTags) if (keywords.has(t)) score += 1;
    if (mood) {
      if (segTags.includes(mood) || seasonMood.includes(mood)) score += 1;
    }
    return { video, segment, score };
  });

  ranked.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreak: prefer local availability, then longer segments
    const aLocal = a.video.availability === "local" ? 1 : 0;
    const bLocal = b.video.availability === "local" ? 1 : 0;
    if (aLocal !== bLocal) return bLocal - aLocal;
    return (b.segment.end_sec - b.segment.start_sec) - (a.segment.end_sec - a.segment.start_sec);
  });
  return ranked;
}

function matchesSearch(item: FlatSegment, query: string): boolean {
  if (!query) return true;
  const tokens = tokenize(query);
  if (!tokens.length) return true;
  const haystack = [
    item.video.id,
    item.video.filename,
    item.video.description ?? "",
    item.segment.id,
    item.segment.description ?? "",
    ...(item.segment.tags ?? []),
    ...(item.segment.concepts?.scene_fit ?? []),
    ...(item.segment.concepts?.weather ?? []),
    item.video.tags?.main ?? "",
    item.video.tags?.secondary ?? "",
    item.video.tags?.third ?? "",
  ].join(" ").toLowerCase();
  return tokens.every((t) => haystack.includes(t));
}

const MAX_VISIBLE = 60;

export function CatalogPickerModal({
  scene,
  jobId,
  scenes,
  timeline,
  mode,
  pickIndex,
  pick,
  excludeSegmentIds = [],
  onClose,
  onCommitted,
}: CatalogPickerModalProps) {
  const { data: videos = [], isLoading, isError } = useCatalog();
  const [showAll, setShowAll] = useState(false);
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [selected, setSelected] = useState<FlatSegment | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const excludeSet = useMemo(() => new Set(excludeSegmentIds.map(String)), [excludeSegmentIds]);

  const audioStart = Number(pick?.audio_start ?? scene.start_sec ?? 0);
  const audioEnd = Number(pick?.audio_end ?? scene.end_sec ?? 0);
  const audioDuration = Math.max(0, audioEnd - audioStart);

  const flat: FlatSegment[] = useMemo(() => {
    const out: FlatSegment[] = [];
    for (const video of videos) {
      for (const segment of video.segments ?? []) {
        if (!segment.id) continue;
        if (excludeSet.has(segment.id)) continue;
        out.push({ video, segment });
      }
    }
    return out;
  }, [videos, excludeSet]);

  const sources = useMemo(() => {
    const set = new Set<string>();
    for (const v of videos) if (v.source) set.add(v.source);
    return Array.from(set).sort();
  }, [videos]);

  const ranked = useMemo(() => {
    const filtered = flat.filter((item) => {
      if (sourceFilter && item.video.source !== sourceFilter) return false;
      if (!matchesSearch(item, search)) return false;
      return true;
    });
    const r = rankForScene(filtered, scene);
    if (!showAll) {
      const hasMatches = r.some((it) => it.score > 0);
      return hasMatches ? r.filter((it) => it.score > 0) : r; // fall through if nothing matches
    }
    return r;
  }, [flat, scene, search, sourceFilter, showAll]);

  const visible = ranked.slice(0, MAX_VISIBLE);
  const truncatedCount = ranked.length - visible.length;

  const handleConfirm = async () => {
    if (!selected) return;
    setSaving(true);
    setError(null);
    try {
      // pick_index is omitted for scene-fill (append a new pick). Coercing to
      // 0 here was the long-standing bug — it either errored ("not found") when
      // the scene was empty, or silently overwrote pick #0 instead of adding.
      const body: Record<string, unknown> = {
        job_id: jobId,
        scenes,
        timeline,
        scene_idx: scene.idx,
        new_segment_id: selected.segment.id,
      };
      if (pickIndex != null) body.pick_index = pickIndex;
      const res = await fetch("/api/pick_segment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json() as {
        success: boolean;
        error?: string;
        timeline?: TimelinePick[];
        validator?: Record<string, unknown>;
      };
      if (!data.success || !data.timeline) {
        setError(data.error ?? "שגיאה בשמירה");
        return;
      }
      onCommitted({ timeline: data.timeline, validator: data.validator ?? {} });
      if (mode === "pick-swap") {
        onClose();
      } else {
        // scene-fill: clear selection so user can chain another pick for the next slot
        setSelected(null);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const headerTitle = mode === "pick-swap"
    ? `סצינה ${scene.idx + 1} · החלף קליפ #${(pickIndex ?? 0) + 1}`
    : `סצינה ${scene.idx + 1} · בחר קליפ ידנית`;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="picker-modal-title"
      tabIndex={-1}
    >
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog modal-dialog--wide" dir="rtl">
        <header className="modal-header">
          <h2 className="modal-title" id="picker-modal-title">
            <span>{headerTitle}</span>
            <span className="modal-subtitle" dir="ltr">
              {formatTime(audioStart, 1)}–{formatTime(audioEnd, 1)} · {audioDuration.toFixed(1)}s
            </span>
          </h2>
          <button type="button" className="modal-close" aria-label="סגור" onClick={onClose}>×</button>
        </header>

        <div className="modal-body catalog-picker">
          {error && <div className="error-banner" role="alert">{error}</div>}

          <div className="catalog-picker__toolbar">
            <div className="catalog-picker__toggle" role="group" aria-label="מסנן ראשי">
              <button
                type="button"
                className="catalog-picker__toggle-btn"
                aria-pressed={!showAll}
                onClick={() => setShowAll(false)}
              >
                מתאים לסצינה
              </button>
              <button
                type="button"
                className="catalog-picker__toggle-btn"
                aria-pressed={showAll}
                onClick={() => setShowAll(true)}
              >
                הצג הכול
              </button>
            </div>
            <input
              type="search"
              className="catalog-picker__search"
              placeholder="חפש לפי תיאור, תגית, או מזהה…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="חיפוש"
            />
            {sources.length > 0 && (
              <div className="catalog-picker__sources" role="group" aria-label="מקור">
                <button
                  type="button"
                  className="catalog-picker__source-btn"
                  aria-pressed={sourceFilter === null}
                  onClick={() => setSourceFilter(null)}
                >
                  הכל
                </button>
                {sources.map((s) => (
                  <button
                    key={s}
                    type="button"
                    className="catalog-picker__source-btn"
                    aria-pressed={sourceFilter === s}
                    onClick={() => setSourceFilter(sourceFilter === s ? null : s)}
                  >
                    {labelFor(s)}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="catalog-picker__grid">
            <div className="catalog-picker__list" role="listbox" aria-label="קליפים זמינים">
              {isLoading && <div className="catalog-picker__hint">טוען קטלוג…</div>}
              {isError && <div className="catalog-picker__hint">לא ניתן לטעון את הקטלוג</div>}
              {!isLoading && visible.length === 0 && (
                <div className="catalog-picker__hint">
                  אין תוצאות. נסה את &quot;הצג הכול&quot; או נקה את החיפוש.
                </div>
              )}
              {visible.map(({ video, segment, score }) => {
                const isSelected = selected?.segment.id === segment.id;
                const segDur = segment.end_sec - segment.start_sec;
                const thumb = `/api/catalog/segment-poster/${encodeURIComponent(segment.id)}`;
                return (
                  <button
                    key={`${video.id}-${segment.id}`}
                    type="button"
                    className={`catalog-picker__row${isSelected ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => setSelected({ video, segment })}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img className="catalog-picker__thumb" src={thumb} alt={segment.id} loading="lazy" />
                    <div className="catalog-picker__meta">
                      <div className="catalog-picker__row-head">
                        <span className="catalog-picker__seg-id">{segment.id}</span>
                        <span className="catalog-picker__seg-time" dir="ltr">{segmentTimeRange(segment)}</span>
                        {score > 0 && !showAll && (
                          <span className="catalog-picker__score" title="ציון התאמה לסצינה">★ {score}</span>
                        )}
                      </div>
                      {segment.description && (
                        <div className="catalog-picker__desc">{segment.description}</div>
                      )}
                      <div className="catalog-picker__chips">
                        {video.source && (
                          <span className="catalog-picker__chip catalog-picker__chip--source">
                            {labelFor(video.source)}
                          </span>
                        )}
                        <span className="catalog-picker__chip" dir="ltr">
                          {segDur.toFixed(1)}s
                        </span>
                        {(segment.tags ?? []).slice(0, 4).map((t) => (
                          <span key={t} className="catalog-picker__chip">{labelFor(t)}</span>
                        ))}
                      </div>
                    </div>
                  </button>
                );
              })}
              {truncatedCount > 0 && (
                <div className="catalog-picker__hint">
                  +{truncatedCount} תוצאות נוספות. צמצם את החיפוש כדי לראות יותר.
                </div>
              )}
            </div>

            <aside className="catalog-picker__preview" aria-label="תצוגה מקדימה">
              {selected ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="catalog-picker__preview-thumb"
                    src={`/api/catalog/segment-poster/${encodeURIComponent(selected.segment.id)}`}
                    alt={selected.segment.id}
                  />
                  <div className="catalog-picker__preview-title">{selected.segment.id}</div>
                  <div className="catalog-picker__preview-sub" dir="ltr">
                    {segmentTimeRange(selected.segment)} · {(selected.segment.end_sec - selected.segment.start_sec).toFixed(1)}s
                  </div>
                  {selected.segment.description && (
                    <p className="catalog-picker__preview-desc">{selected.segment.description}</p>
                  )}
                  <div className="catalog-picker__fit">
                    {selected.segment.end_sec - selected.segment.start_sec >= audioDuration
                      ? `ימולא ${audioDuration.toFixed(1)}s מתוך ${(selected.segment.end_sec - selected.segment.start_sec).toFixed(1)}s במקטע`
                      : `⚠️ המקטע קצר מהסלוט (${(selected.segment.end_sec - selected.segment.start_sec).toFixed(1)}s < ${audioDuration.toFixed(1)}s)`}
                  </div>
                </>
              ) : (
                <div className="catalog-picker__preview-empty">
                  בחר קליפ מהרשימה כדי לראות תצוגה מקדימה.
                </div>
              )}
            </aside>
          </div>
        </div>

        <footer className="modal-footer">
          <button type="button" className="btn btn--secondary" onClick={onClose}>
            {mode === "scene-fill" ? "סגור" : "ביטול"}
          </button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={!selected || saving}
            onClick={handleConfirm}
          >
            {saving ? "שומר…" : "אשר בחירה"}
          </button>
        </footer>
      </div>
    </div>
  );
}
