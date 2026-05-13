"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { StudioPhase, TileState } from "./StudioPanel";
import { SceneCard } from "./SceneCard";
import type { Scene } from "@/shared/types";
import { formatTime } from "@/client/lib/format-time";
import { pickDisplayReason } from "@/client/lib/plan-pick-display";

interface TranscriptData {
  job_id: string;
  transcript: string;
  duration: number;
  filename: string;
  segments: Array<{ idx?: number; start: number; end: number; text: string }>;
}

interface PlanData {
  scenes: Scene[];
  timeline: Record<string, unknown>[];
  validator: Record<string, unknown>;
}

interface PlanCardProps {
  jobId: string | null;
  transcriptData: TranscriptData | null;
  planData: PlanData | null;
  phase: StudioPhase;
  tileState: TileState;
  onPlanSuccess: (data: PlanData) => void;
  onReplan: (data: PlanData) => void;
  onPhaseChange: (phase: StudioPhase) => void;
  onError: (msg: string) => void;
}

const STATUS_LABELS: Record<TileState, string> = {
  "is-skeleton": "ממתין",
  waiting: "בתור",
  active: "מעבד",
  completed: "הושלם",
  failed: "נכשל",
};

export function PlanCard({
  jobId,
  transcriptData,
  planData,
  phase,
  tileState,
  onPlanSuccess,
  onReplan,
  onPhaseChange,
  onError,
}: PlanCardProps) {
  const [loading, setLoading] = useState(false);
  const hasPlan = !!planData;
  const triggeredForJobRef = useRef<string | null>(null);

  const handlePlan = useCallback(async () => {
    if (!transcriptData || !jobId) return;
    setLoading(true);
    onPhaseChange("planning");
    try {
      const res = await fetch("/api/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: jobId,
          transcript: transcriptData.transcript,
          duration: transcriptData.duration,
          transcript_segments: transcriptData.segments.map((s, i) => ({
            idx: i,
            start: s.start,
            end: s.end,
            text: s.text,
          })),
        }),
      });
      const data = await res.json() as {
        success: boolean;
        error?: string;
        scenes?: Scene[];
        timeline?: Record<string, unknown>[];
        validator?: Record<string, unknown>;
      };
      if (!data.success) throw new Error(data.error ?? "Planning failed");
      onPlanSuccess({
        scenes: data.scenes ?? [],
        timeline: data.timeline ?? [],
        validator: data.validator ?? {},
      });
    } catch (err) {
      onError(String(err));
      onPhaseChange("transcribed");
    } finally {
      setLoading(false);
    }
  }, [transcriptData, jobId, onPlanSuccess, onPhaseChange, onError]);

  // Auto-plan as soon as transcription completes, mirroring the Flask flow.
  useEffect(() => {
    if (phase !== "transcribed") return;
    if (!transcriptData || !jobId) return;
    if (hasPlan) return;
    if (triggeredForJobRef.current === jobId) return;
    triggeredForJobRef.current = jobId;
    handlePlan();
  }, [phase, transcriptData, jobId, hasPlan, handlePlan]);

  const getPicksForScene = (sceneIdx: number) =>
    (planData?.timeline ?? []).filter((p) => Number(p.scene_idx) === sceneIdx);

  return (
    <section
      className={`tile step ${tileState}`}
      id="step-plan"
      data-area="plan"
      data-waits-for="תמלול"
      data-expanded="false"
      aria-label="שלב 2 — תכנון"
    >
      <header className="tile-header">
        <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>
          <circle cx="7" cy="6" r="1.6" fill="currentColor"/>
          <circle cx="14" cy="12" r="1.6" fill="currentColor"/>
          <circle cx="10" cy="18" r="1.6" fill="currentColor"/>
        </svg>
        <span className="step-title">ציר זמן</span>
        <span className="status-pill">
          {loading ? "מעבד" : STATUS_LABELS[tileState]}
        </span>
      </header>
      <div className="tile-body">
        <div className="waiting-state" aria-hidden="true">
          <div className="waiting-glyph">
            <svg className="icon" viewBox="0 0 24 24">
              <path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/>
              <circle cx="7" cy="6" r="1.6" fill="currentColor"/>
              <circle cx="14" cy="12" r="1.6" fill="currentColor"/>
              <circle cx="10" cy="18" r="1.6" fill="currentColor"/>
            </svg>
          </div>
          <span className="waiting-badge">
            <svg className="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            ממתין ל<span className="waiting-label-text"></span>
          </span>
          <div className="waiting-track"></div>
        </div>
        <div className="step-content scroll-y" id="plan-result">
          {(tileState === "active" && !hasPlan) && (
            <div className="skeleton-rows" aria-hidden="true"><span/><span/><span/><span/><span/></div>
          )}
          {tileState === "is-skeleton" && (
            <div className="skeleton-rows" aria-hidden="true"><span/><span/><span/><span/><span/></div>
          )}
          {hasPlan && planData && (() => {
            const scenesArr = planData.scenes;
            const tl = planData.timeline;
            const totalSec = scenesArr.length ? Number(scenesArr[scenesArr.length - 1].end_sec || 0) : 0;
            const orphans = tl.filter((c) => c.scene_idx === null || c.scene_idx === undefined);
            return (
              <div className="scene-timeline">
                <div className="scene-timeline-header">
                  <span><strong>{scenesArr.length}</strong> סצינות · {formatTime(totalSec, 1)}</span>
                  <span>{tl.length} קליפים</span>
                </div>
                {scenesArr.map((scene) => (
                  <SceneCard
                    key={scene.idx}
                    scene={scene}
                    picks={getPicksForScene(scene.idx).sort(
                      (a, b) => Number(a.audio_start ?? 0) - Number(b.audio_start ?? 0),
                    )}
                    jobId={jobId}
                    fullTimeline={planData.timeline}
                    fullScenes={planData.scenes}
                    validator={planData.validator}
                    onReplan={onReplan}
                  />
                ))}
                {orphans.length > 0 && (
                  <div className="scene-block" style={{ borderStyle: "dotted" }}>
                    <div className="scene-head">
                      <span className="scene-id">קליפים ללא סצינה</span>
                    </div>
                    <div className="scene-picks">
                      {orphans.map((p, i) => {
                        const id = String(p.segment_id ?? p.video_id ?? "?");
                        const range = `${formatTime(Number(p.video_start ?? 0), 1)}–${formatTime(Number(p.video_end ?? 0), 1)}`;
                        const why = pickDisplayReason(p);
                        return (
                          <div key={i} className="scene-pick">
                            <div className="scene-pick-thumb" />
                            <div className="scene-pick-meta">
                              <div className="scene-pick-id">{id} · {range}</div>
                              {why != null && (
                                <div className="scene-pick-reason">{why}</div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      </div>
    </section>
  );
}
