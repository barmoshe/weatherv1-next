"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { ParsedVideo } from "@/shared/types";
import { VideoCard } from "./VideoCard";

interface VideoGridProps {
  videos: ParsedVideo[];
  onVideoClick: (video: ParsedVideo) => void;
  onMaterialize?: (video: ParsedVideo) => void;
  viewMode?: "grid" | "list";
  pageSize?: number;
}

function availabilityText(video: ParsedVideo): string {
  if (video.availability === "local") return "מקומי";
  if (video.availability === "cloud_only") return "בענן בלבד";
  if (video.availability === "syncing") return "מסנכרן";
  return "שגיאה";
}

export function VideoGrid({ videos, onVideoClick, onMaterialize, viewMode = "grid", pageSize = 24 }: VideoGridProps) {
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const sentinelRef = useRef<HTMLDivElement>(null);

  // Reset visible count when the filtered list changes
  useEffect(() => {
    setVisibleCount(pageSize);
  }, [videos, pageSize]);

  // Infinite-scroll sentinel
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setVisibleCount((n) => Math.min(n + pageSize, videos.length));
        }
      },
      { rootMargin: "400px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [videos.length, pageSize]);

  const visible = videos.slice(0, visibleCount);

  if (videos.length === 0) {
    return (
      <div className="catalog-grid" id="catalog-grid">
        <div className="catalog-empty">לא נמצאו סרטונים</div>
      </div>
    );
  }

  if (viewMode === "list") {
    return (
      <div className="catalog-list" role="list" aria-label={`${videos.length} סרטונים`}>
        {visible.map((v) => (
          <button key={v.id} type="button" className="catalog-list-row" onClick={() => onVideoClick(v)}>
            <span className={`cloud-dot cloud-dot--${v.availability}`} />
            <span className="catalog-list-main">
              <strong>{v.filename}</strong>
              <small>{v.id} · {Math.round(v.duration_sec ?? 0)} שנ׳ · {v.source ?? "original"}</small>
            </span>
            <span className="catalog-list-status">{availabilityText(v)}</span>
            {v.availability === "cloud_only" && (
              <span
                role="button"
                tabIndex={0}
                className="catalog-list-action"
                onClick={(e) => {
                  e.stopPropagation();
                  onMaterialize?.(v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    e.stopPropagation();
                    onMaterialize?.(v);
                  }
                }}
              >
                הורד
              </span>
            )}
          </button>
        ))}
        {visibleCount < videos.length && <div ref={sentinelRef} className="catalog-grid__sentinel" aria-hidden="true" />}
      </div>
    );
  }

  return (
    <>
      <div className="catalog-grid" id="catalog-grid" role="list" aria-label={`${videos.length} סרטונים`}>
        {visible.map((v) => (
          <VideoCard key={v.id} video={v} onClick={onVideoClick} onMaterialize={onMaterialize} />
        ))}
      </div>

      {visibleCount < videos.length && (
        <div
          ref={sentinelRef}
          className="catalog-grid__sentinel"
          aria-hidden="true"
          style={{ height: 1 }}
        />
      )}
    </>
  );
}
