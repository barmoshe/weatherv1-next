"use client";

import { useState, KeyboardEvent } from "react";
import type { NormalisedSegment } from "@/shared/types";

interface SegmentRowProps {
  segment: NormalisedSegment;
  onChange?: (updated: NormalisedSegment) => void;
  readOnly?: boolean;
}

function formatTimecode(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function SegmentRow({ segment, onChange, readOnly = false }: SegmentRowProps) {
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
    <div className="segment-row" data-segment-id={segment.id}>
      <div className="segment-row__thumb">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={posterUrl}
          alt={`תמונה ממקטע ${segment.id}`}
          className="segment-row__poster"
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>

      <div className="segment-row__info">
        <div className="segment-row__header">
          <span className="segment-row__id">{segment.id}</span>
          <span className="segment-row__timecode">
            {formatTimecode(segment.start_sec)} – {formatTimecode(segment.end_sec)}
          </span>
          {segment.confidence != null && (
            <span
              className="segment-row__confidence"
              title={`ביטחון: ${Math.round(segment.confidence * 100)}%`}
            >
              {Math.round(segment.confidence * 100)}%
            </span>
          )}
        </div>

        {segment.description && (
          <p className="segment-row__desc">{segment.description}</p>
        )}

        <div className="segment-row__tags">
          {tags.map((tag) => (
            <span key={tag} className="tag-pill">
              {tag}
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
              className="segment-row__tag-input"
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
    </div>
  );
}
