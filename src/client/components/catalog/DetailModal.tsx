"use client";

import { useState, useCallback, KeyboardEvent } from "react";
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

  function handleOverlayClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target === e.currentTarget) onClose();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") onClose();
  }

  return (
    <div
      className="modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="detail-modal-title"
      onClick={handleOverlayClick}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
    >
      <div className="modal" dir="rtl">
        <div className="modal__header">
          <h2 className="modal__title" id="detail-modal-title">
            {video.id}
            <span className="modal__subtitle">{video.filename}</span>
          </h2>
          <button
            type="button"
            className="modal-close btn btn--ghost btn--sm"
            aria-label="סגור"
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        <div className="modal__body">
          {error && (
            <div className="modal__error" role="alert">
              {error}
            </div>
          )}

          {/* Description */}
          <div className="field-group">
            <label className="field-label" htmlFor="detail-description">
              תיאור
            </label>
            <textarea
              id="detail-description"
              className="field-input"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="תיאור הקטע..."
            />
          </div>

          {/* Source */}
          <div className="field-group">
            <label className="field-label" htmlFor="detail-source">
              מקור
            </label>
            <select
              id="detail-source"
              className="field-input field-select"
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

          {/* Segments */}
          {segments.length > 0 && (
            <div className="field-group">
              <p className="field-label">מקטעים ({segments.length})</p>
              <div className="segments-list">
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

        <div className="modal__footer">
          <div className="modal__footer-start">
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
          <div className="modal__footer-end">
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
          </div>
        </div>
      </div>
    </div>
  );
}
