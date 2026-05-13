"use client";

import { useState, KeyboardEvent } from "react";
import { labelFor } from "@/client/lib/tag-labels";
import type { NormalisedSegment } from "@/shared/types";

interface SegmentRowProps {
  segment: NormalisedSegment;
  onChange?: (updated: NormalisedSegment) => void;
  readOnly?: boolean;
  index?: number;
  domId?: string;
}

function formatTimecode(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function SegmentRow({ segment, onChange, readOnly = false, index, domId }: SegmentRowProps) {
  const [tagInput, setTagInput] = useState("");
  const tags = segment.tags ?? [];

  function addTag(raw: string) {
    const tag = raw.trim();
    if (!tag || tags.includes(tag)) return;
    onChange?.({ ...segment, tags: [...tags, tag] });
    setTagInput("");
  }

  function removeTag(tag: string) {
    onChange?.({ ...segment, tags: tags.filter((t) => t !== tag) });
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addTag(tagInput);
    } else if (e.key === "Backspace" && tagInput === "" && tags.length > 0) {
      removeTag(tags[tags.length - 1]);
    }
  }

  const posterUrl = `/api/catalog/segment-poster/${encodeURIComponent(segment.id)}`;

  return (
    <div className="segment-block" id={domId} data-segment-id={segment.id}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={posterUrl}
        alt={`תמונה ממקטע ${segment.id}`}
        className="segment-thumb"
        loading="lazy"
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />

      <div className="segment-header">
        {index != null && <span className="segment-index">מקטע {index + 1}</span>}
        <span className="segment-id">{segment.id}</span>
        <span className="segment-time">
          {formatTimecode(segment.start_sec)} – {formatTimecode(segment.end_sec)}
        </span>
        {segment.confidence != null && (
          <span
            className="segment-conf"
            title={`ביטחון: ${Math.round(segment.confidence * 100)}%`}
          >
            {Math.round(segment.confidence * 100)}%
          </span>
        )}
      </div>

      {readOnly ? (
        segment.description ? (
          <p className="segment-desc-input segment-desc-text">{segment.description}</p>
        ) : (
          <span className="segment-desc-spacer" aria-hidden="true" />
        )
      ) : (
        <textarea
          className="segment-desc-input"
          rows={2}
          value={segment.description ?? ""}
          onChange={(e) => onChange?.({ ...segment, description: e.target.value })}
          placeholder="תיאור קצר של מה שרואים במקטע"
          aria-label={`תיאור מקטע ${segment.id}`}
        />
      )}

      <div className="segment-tags-input">
        {tags.map((tag) => (
          <span key={tag} className="tag-pill" title={tag}>
            {labelFor(tag)}
            {!readOnly && (
              <button
                type="button"
                className="tag-pill__remove"
                aria-label={`הסר תגית ${tag}`}
                onClick={() => removeTag(tag)}
              >
                ×
              </button>
            )}
          </span>
        ))}

        {!readOnly && (
          <input
            type="text"
            className="segment-tag-add"
            placeholder="הוסף תגית..."
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={() => {
              if (tagInput.trim()) addTag(tagInput);
            }}
            aria-label="הוסף תגית למקטע"
          />
        )}
      </div>
    </div>
  );
}
