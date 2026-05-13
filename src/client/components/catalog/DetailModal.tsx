"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  availabilityLongLabel,
  catalogDurationLabel,
  catalogVideoMeta,
  catalogVideoTitle,
  segmentListStats,
  segmentTimeRange,
} from "@/client/lib/catalog-display";
import { labelFor } from "@/client/lib/tag-labels";
import type { ParsedVideo, NormalisedSegment } from "@/shared/types";
import { SOURCE_VALUES } from "@/server/tag-vocab";
import { SegmentRow } from "./SegmentRow";

interface DetailModalProps {
  video: ParsedVideo;
  onClose: () => void;
}

function segmentDomId(videoId: string, segmentId: string): string {
  return `detail-segment-${videoId}-${segmentId}`.replace(/[^A-Za-z0-9_-]/g, "-");
}

export function DetailModal({ video, onClose }: DetailModalProps) {
  const qc = useQueryClient();

  const [description, setDescription] = useState(video.description ?? "");
  const [source, setSource] = useState(video.source ?? "original");
  const [segments, setSegments] = useState<NormalisedSegment[]>(
    video.segments ?? []
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const handleSegmentChange = useCallback(
    (updated: NormalisedSegment) => {
      setSegments((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
    },
    []
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalog/videos/${encodeURIComponent(video.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description, source, segments }),
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) {
        setError(data.error ?? "שגיאה בשמירה");
        return;
      }
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      await qc.invalidateQueries({ queryKey: ["tag-counts"] });
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }, [video.id, description, source, segments, qc, onClose]);

  const handleDelete = useCallback(async () => {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/catalog/videos/${encodeURIComponent(video.id)}`, {
        method: "DELETE",
      });
      const data = (await res.json()) as { success: boolean; error?: string };
      if (!data.success) {
        setError(data.error ?? "שגיאה במחיקה");
        setSaving(false);
        setConfirmDelete(false);
        return;
      }
      await qc.invalidateQueries({ queryKey: ["catalog"] });
      await qc.invalidateQueries({ queryKey: ["tag-counts"] });
      onClose();
    } catch (err) {
      setError(String(err));
      setSaving(false);
      setConfirmDelete(false);
    }
  }, [confirmDelete, video.id, qc, onClose]);

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  const title = catalogVideoTitle(video);
  const meta = catalogVideoMeta(video);
  const segmentStats = segmentListStats(segments);

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-modal-title"
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog modal-dialog--wide" dir="rtl">
        <header className="modal-header">
          <h2 className="modal-title" id="detail-modal-title">
            <span className="detail-modal-title-main">{title}</span>
            <span className="modal-subtitle" dir="ltr">{meta}</span>
          </h2>
          <button
            type="button"
            className="modal-close"
            aria-label="סגור"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="modal-body">
          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}

          <div className="detail-editor-shell">
            <aside className="detail-asset-panel" aria-label="פרטי קליפ">
              <div className="detail-asset-summary">
                <span className={`cloud-dot cloud-dot--${video.availability}`} aria-hidden="true" />
                <span>{availabilityLongLabel(video)}</span>
                {catalogDurationLabel(video.duration_sec) && (
                  <span className="detail-asset-duration">
                    {catalogDurationLabel(video.duration_sec)}
                  </span>
                )}
              </div>
              <div className="detail-asset-stat-grid" aria-label="סיכום מקטעים">
                <span>
                  <strong>{segmentStats.total}</strong>
                  מקטעים
                </span>
                <span>
                  <strong>{segmentStats.tagged}</strong>
                  מתויגים
                </span>
                <span>
                  <strong>{segmentStats.empty}</strong>
                  חסרים
                </span>
              </div>

              <div className="field">
                <label className="field-label" htmlFor="detail-description">
                  תיאור כללי
                </label>
                <textarea
                  id="detail-description"
                  rows={4}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="תיאור קצר של הקליפ כולו"
                />
              </div>

              <div className="field">
                <label className="field-label" htmlFor="detail-source">
                  מקור
                </label>
                <select
                  id="detail-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as typeof source)}
                >
                  {SOURCE_VALUES.map((s) => (
                    <option key={s} value={s}>
                      {labelFor(s)}
                    </option>
                  ))}
                </select>
              </div>

              <dl className="detail-meta">
                <dt>מזהה</dt>
                <dd dir="ltr">{video.id}</dd>
                <dt>קובץ</dt>
                <dd dir="ltr">{video.filename}</dd>
              </dl>
            </aside>

            <section className="detail-segment-panel" aria-label="מקטעי הקליפ">
              <header className="detail-segment-header">
                <div>
                  <h3>מקטעים</h3>
                  <p>{segments.length ? `${segments.length} מקטעים לעריכה לפי זמן ותוכן` : "אין מקטעים בקליפ הזה"}</p>
                </div>
                {segmentStats.total > 0 && (
                  <div className="detail-segment-stats" aria-label="מצב מקטעים">
                    <span>{segmentStats.described} עם תיאור</span>
                    <span>{segmentStats.tagged} מתויגים</span>
                    {segmentStats.empty > 0 && <span className="is-warning">{segmentStats.empty} חסרים</span>}
                  </div>
                )}
              </header>
              {segments.length > 0 && (
                <div className="detail-segment-strip" aria-label="ניווט מהיר בין מקטעים">
                  {segments.map((seg, index) => {
                    const domId = segmentDomId(video.id, seg.id);
                    return (
                      <button
                        key={seg.id}
                        type="button"
                        className="detail-segment-jump"
                        onClick={() => document.getElementById(domId)?.scrollIntoView({ behavior: "smooth", block: "nearest" })}
                        aria-label={`עבור למקטע ${index + 1}`}
                      >
                        <span>{index + 1}</span>
                        <span dir="ltr">{segmentTimeRange(seg)}</span>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="detail-segments">
                {segments.map((seg, index) => (
                  <SegmentRow
                    key={seg.id}
                    segment={seg}
                    index={index}
                    domId={segmentDomId(video.id, seg.id)}
                    onChange={handleSegmentChange}
                  />
                ))}
              </div>
            </section>
          </div>
        </div>

        <footer className="modal-footer detail-footer">
          <div className="detail-footer__danger">
            <button
              type="button"
              className={`btn btn--danger btn--sm${confirmDelete ? " btn--confirm" : ""}`}
              onClick={handleDelete}
              disabled={saving}
            >
              {confirmDelete ? "אשר מחיקה" : "מחק"}
            </button>
            {confirmDelete && (
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => setConfirmDelete(false)}
              >
                ביטול
              </button>
            )}
          </div>
          <button
            type="button"
            className="btn btn--secondary btn--sm"
            onClick={onClose}
            disabled={saving}
          >
            ביטול
          </button>
          <button
            type="button"
            className="btn btn--primary btn--sm"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? "שומר..." : "שמור"}
          </button>
        </footer>
      </div>
    </div>
  );
}
