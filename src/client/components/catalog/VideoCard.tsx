"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { ParsedVideo } from "@/shared/types";
import { labelFor } from "@/client/lib/tag-labels";

interface VideoCardProps {
  video: ParsedVideo;
  onClick: (video: ParsedVideo) => void;
  onMaterialize?: (video: ParsedVideo) => void;
}

function topSegmentTags(video: ParsedVideo, limit: number): string[] {
  const counts = new Map<string, number>();
  for (const seg of video.segments ?? []) {
    for (const t of seg.tags ?? []) {
      if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
    }
  }
  if (counts.size > 0) {
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([t]) => t);
  }
  const lt = video.tags;
  if (!lt) return [];
  if (Array.isArray(lt)) return (lt as string[]).filter(Boolean).slice(0, limit);
  return [lt.main, lt.secondary, lt.third].filter(Boolean).slice(0, limit) as string[];
}

function isVideoUntagged(video: ParsedVideo): boolean {
  for (const seg of video.segments ?? []) {
    if ((seg.tags ?? []).some(Boolean)) return false;
  }
  const lt = video.tags;
  if (!lt) return true;
  if (Array.isArray(lt)) return !lt.some(Boolean);
  return !(lt.main || lt.secondary || lt.third);
}

function availabilityLabel(video: ParsedVideo): string {
  if (video.availability === "local") return "מקומי";
  if (video.availability === "cloud_only") return "בענן";
  if (video.availability === "syncing") return "מסנכרן";
  return "שגיאה";
}

export function VideoCard({ video, onClick, onMaterialize }: VideoCardProps) {
  const cardRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [posterVisible, setPosterVisible] = useState(false);
  const [videoSrc, setVideoSrc] = useState<string | null>(null);
  const [hovered, setHovered] = useState(false);

  const safeId = encodeURIComponent(video.id || "");
  const posterUrl = `/api/catalog/poster/${safeId}`;
  const previewUrl = `/api/catalog/preview/${safeId}`;

  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          setPosterVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (hovered && posterVisible && !videoSrc) {
      setVideoSrc(previewUrl);
    }
  }, [hovered, posterVisible, videoSrc, previewUrl]);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !videoSrc) return;
    if (hovered) {
      vid.play().catch(() => {});
    } else {
      vid.pause();
      vid.currentTime = 0;
    }
  }, [hovered, videoSrc]);

  const handleClick = useCallback(() => onClick(video), [onClick, video]);
  const handleMaterialize = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onMaterialize?.(video);
  }, [onMaterialize, video]);
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onClick(video);
      }
    },
    [onClick, video]
  );

  const orientation = video.orientation || "H";
  const orientLabel = orientation === "V" ? "אנכי" : "אופקי";
  const dur = video.duration_sec ? `${Math.round(video.duration_sec)} שנ׳` : "";
  const untagged = isVideoUntagged(video);
  const tags = topSegmentTags(video, 3);
  const segCount = (video.segments ?? []).length;

  return (
    <article
      ref={cardRef}
      className="video-card"
      tabIndex={0}
      role="button"
      aria-label={`ערוך תיוגים ${video.id}`}
      data-video-id={video.id}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-availability={video.availability}
    >
      <div className="video-thumb" data-video-src={previewUrl}>
        {posterVisible && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            className="thumb-poster"
            src={posterUrl}
            loading="lazy"
            decoding="async"
            alt=""
          />
        )}
        {videoSrc && (
          <video
            ref={videoRef}
            src={videoSrc}
            muted
            loop
            playsInline
            preload="metadata"
            aria-hidden="true"
          />
        )}
        <span className="orient-badge">{orientLabel}</span>
        <span className={`cloud-badge cloud-badge--${video.availability}`}>
          {availabilityLabel(video)}
        </span>
        {dur && <span className="duration-badge">{dur}</span>}
        {untagged && <span className="untagged-badge">לא מתויג</span>}
        {video.source && (
          <span className="source-badge">
            {labelFor(video.source)}
          </span>
        )}
        {video.availability === "cloud_only" && (
          <button type="button" className="thumb-download-btn" onClick={handleMaterialize}>
            הורד
          </button>
        )}
      </div>
      <div className="video-card-body">
        <span className="video-card-id">{video.id}</span>
        <span className="video-card-title" dir="auto">
          {video.filename || ""}
        </span>
        <div className="video-card-tags">
          {segCount > 1 && (
            <span className="segment-count-badge" title={`${segCount} מקטעים`}>
              {segCount} מקטעים
            </span>
          )}
          {tags.map((tag) => (
            <span key={tag} className="tag-pill tag-pill--main">
              {labelFor(tag)}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
