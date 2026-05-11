"use client";
import { useState } from "react";
import type { Scene } from "@/shared/types";
import { formatTime, segmentPosterUrl } from "@/client/lib/format-time";
import { labelFor } from "@/client/lib/tag-labels";

interface SceneCardProps {
  scene: Scene;
  picks: Record<string, unknown>[];
  jobId: string | null;
  fullTimeline: Record<string, unknown>[];
  fullScenes: Scene[];
  validator: Record<string, unknown>;
  onReplan: (data: { scenes: Scene[]; timeline: Record<string, unknown>[]; validator: Record<string, unknown> }) => void;
}

const KIND_LABEL_HE: Record<string, string> = {
  prose: "תיאור",
  list: "רשימה",
  transition: "מעבר",
};

export function SceneCard({ scene, picks, jobId, fullTimeline, fullScenes, validator, onReplan }: SceneCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleReplan = async () => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/replan_scene", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          scenes: fullScenes,
          timeline: fullTimeline,
          scene_idx: scene.idx,
        }),
      });
      const data = await res.json() as {
        success: boolean;
        error?: string;
        scenes?: Scene[];
        timeline?: Record<string, unknown>[];
        validator?: Record<string, unknown>;
      };
      if (!data.success) throw new Error(data.error ?? "Failed");
      onReplan({
        scenes: data.scenes ?? fullScenes,
        timeline: data.timeline ?? fullTimeline,
        validator: data.validator ?? {},
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const kind = String(scene.kind || "prose");
  const kindClass = kind === "list" ? "is-list" : kind === "transition" ? "is-transition" : "";
  const kindLabel = KIND_LABEL_HE[kind] ?? "תיאור";
  const range = `${formatTime(scene.start_sec, 1)}–${formatTime(scene.end_sec, 1)}`;

  const gapFilledIdxs = (((validator?.gap_filled as Array<{ fixed?: boolean; scene_idx?: number }> | undefined) ?? [])
    .filter((g) => g?.fixed)
    .map((g) => Number(g.scene_idx)));
  const isFilled = gapFilledIdxs.includes(scene.idx);

  const blockMods = [
    kind === "list" ? "is-list" : "",
    kind === "transition" ? "is-transition" : "",
    isFilled ? "is-filled" : "",
  ].filter(Boolean).join(" ");

  const keywords = (scene.keywords ?? []).map((k) => labelFor(String(k).toLowerCase()));

  return (
    <div className={`scene-block ${blockMods}`} data-scene-idx={scene.idx}>
      <div className="scene-head">
        <span className="scene-id">
          סצינה {scene.idx + 1} · <span className="scene-time">{range}</span>
        </span>
        <span className={`scene-kind-pill ${kindClass}`}>{kindLabel}</span>
        <button
          className="scene-reroll-btn"
          type="button"
          data-reroll-scene={scene.idx}
          disabled={loading || !jobId}
          onClick={handleReplan}
        >
          {loading ? "⟳ מחפש…" : "⟳ בחר מחדש"}
        </button>
      </div>
      {scene.title_he && <div className="scene-title">{scene.title_he}</div>}
      {scene.narration && <div className="scene-narration">{scene.narration}</div>}
      {keywords.length > 0 && (
        <div className="scene-keywords">
          {keywords.map((k, i) => (
            <span key={i} className="scene-keyword">{k}</span>
          ))}
        </div>
      )}
      {error && <div className="scene-error">{error}</div>}
      <div className="scene-picks">
        {picks.length === 0 ? (
          <div className="scene-empty-msg">אין קליפים — לחץ &quot;בחר מחדש&quot;</div>
        ) : (
          picks.map((p, i) => {
            const id = String(p.segment_id ?? p.video_id ?? "?");
            const pickRange = `${formatTime(Number(p.video_start ?? 0), 1)}–${formatTime(Number(p.video_end ?? 0), 1)}`;
            const poster = segmentPosterUrl(p as { segment_id?: unknown; video_id?: unknown });
            return (
              <div key={i} className="scene-pick">
                {poster ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img className="scene-pick-thumb" src={poster} alt={id} loading="lazy" />
                ) : (
                  <div className="scene-pick-thumb" />
                )}
                <div className="scene-pick-meta">
                  <div className="scene-pick-id">
                    {id} · {pickRange}
                    {isFilled && <span className="gap-fill-tag">מילוי אוטומטי</span>}
                  </div>
                  {p.reason != null && (
                    <div className="scene-pick-reason">{String(p.reason)}</div>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
