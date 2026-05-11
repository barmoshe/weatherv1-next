"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { ParsedVideo } from "@/shared/types";
import { VideoCard } from "./VideoCard";

interface VideoGridProps {
  videos: ParsedVideo[];
  onVideoClick: (video: ParsedVideo) => void;
  pageSize?: number;
}

export function VideoGrid({ videos, onVideoClick, pageSize = 24 }: VideoGridProps) {
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

  return (
    <>
      <div className="catalog-grid" id="catalog-grid" role="list" aria-label={`${videos.length} סרטונים`}>
        {visible.map((v) => (
          <VideoCard key={v.id} video={v} onClick={onVideoClick} />
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
