"use client";

import { useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { ParsedVideo, NormalisedSegment } from "@/shared/types";
import { SOURCE_VALUES } from "@/server/tag-vocab";
import { SegmentRow } from "./SegmentRow";

interface DetailModalProps {
  video: ParsedVideo;
  onClose: () => void;
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
            {video.id}
            <span className="modal-subtitle">{video.filename}</span>
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

          <div className="detail-form-grid">
            <div className="field">
              <label className="field-label" htmlFor="detail-description">
                תיאור
              </label>
              <textarea
                id="detail-description"
                rows={3}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="תיאור הקטע..."
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
                    {s}
                  </option>
                ))}
              </select>
            </div>

            {segments.length > 0 && (
              <div className="field">
                <p className="field-label">מקטעים ({segments.length})</p>
                <div className="detail-segments">
                  {segments.map((seg) => (
                    <SegmentRow
                      key={seg.id}
                      segment={seg}
                      onChange={handleSegmentChange}
                    />
                  ))}
                </div>
              </div>
            )}
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
