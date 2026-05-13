"use client";

import { useRef, useState, useEffect, useCallback } from "react";
import type { ParsedVideo } from "@/shared/types";
import { labelFor } from "@/client/lib/tag-labels";
import {
  availabilityLabel,
  catalogDurationLabel,
  catalogSegmentPreviews,
  catalogSegmentStats,
  catalogVideoMeta,
  catalogVideoTitle,
  hasAnyCatalogTag,
  topCatalogTags,
} from "@/client/lib/catalog-display";

interface VideoCardProps {
  video: ParsedVideo;
  onClick: (video: ParsedVideo) => void;
  onMaterialize?: (video: ParsedVideo) => void;
  searchQuery?: string;
}

export function VideoCard({ video, onClick, onMaterialize, searchQuery = "" }: VideoCardProps) {
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
  const handleMaterialize = useCallback(() => {
    onMaterialize?.(video);
  }, [onMaterialize, video]);

  const orientation = video.orientation || "H";
  const orientLabel = orientation === "V" ? "אנכי" : "אופקי";
  const dur = catalogDurationLabel(video.duration_sec);
  const untagged = !hasAnyCatalogTag(video);
  const tags = topCatalogTags(video, 3);
  const segmentStats = catalogSegmentStats(video);
  const segmentPreviews = catalogSegmentPreviews(video, searchQuery, 2);
  const title = catalogVideoTitle(video);
  const meta = catalogVideoMeta(video);

  return (
    <article
      ref={cardRef}
      className="video-card"
      data-video-id={video.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      data-availability={video.availability}
    >
      <button
        type="button"
        className="video-card-action"
        aria-label={`פתח קליפ: ${title}`}
        onClick={handleClick}
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
          {video.source && <span className="source-badge">{labelFor(video.source)}</span>}
        </div>
        <div className="video-card-body">
          <span className="video-card-title" dir="auto">
            {title}
          </span>
          <span className="video-card-meta" dir="ltr">
            {meta}
          </span>
          <div className="video-card-tags">
            {segmentStats.total > 1 && (
              <span className="segment-count-badge" title={`${segmentStats.total} מקטעים`}>
                {segmentStats.total} מקטעים
              </span>
            )}
            {tags.map((tag) => (
              <span key={tag} className="tag-pill tag-pill--main">
                {labelFor(tag)}
              </span>
            ))}
          </div>
          {segmentStats.total > 0 && (
            <div className="video-card-segment-summary" aria-label="סיכום מקטעים">
              <span>{segmentStats.total} מקטעים</span>
              <span>{segmentStats.tagged} מתויגים</span>
              {segmentStats.empty > 0 && <span className="is-warning">{segmentStats.empty} חסרים</span>}
            </div>
          )}
          {segmentPreviews.length > 0 && (
            <ol className="video-card-segments" aria-label="מקטעים בולטים">
              {segmentPreviews.map((segment) => (
                <li key={segment.id} className="video-card-segment-row">
                  <span className="video-card-segment-time" dir="ltr">
                    {segment.timeRange}
                  </span>
                  <span className="video-card-segment-desc" dir="auto">
                    {segment.description || "מקטע ללא תיאור"}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </button>

      {video.availability === "cloud_only" && (
        <div className="video-card-footer">
          <button type="button" className="video-card-download" onClick={handleMaterialize}>
            הורד מהענן
            <span dir="ltr" className="technical-inline">
              {video.id}
            </span>
          </button>
        </div>
      )}
    </article>
  );
}
