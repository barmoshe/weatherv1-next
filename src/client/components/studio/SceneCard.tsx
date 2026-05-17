"use client";
import { useState } from "react";
import type { Scene, TimelinePick } from "@/shared/types";
import { formatTime, segmentPosterUrl } from "@/client/lib/format-time";
import { pickDisplayReason } from "@/client/lib/plan-pick-display";
import { labelFor } from "@/client/lib/tag-labels";
import { CatalogPickerModal, type PickerMode } from "./CatalogPickerModal";

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

type PickerState = { mode: PickerMode; pickIndex?: number };

export function SceneCard({ scene, picks, jobId, fullTimeline, fullScenes, validator, onReplan }: SceneCardProps) {
  const [loading, setLoading] = useState(false);
  const [busyPickIndex, setBusyPickIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState<PickerState | null>(null);

  async function postReplan(body: Record<string, unknown>) {
    const res = await fetch("/api/replan_scene", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
  }

  const handleReplan = async () => {
    if (!jobId) return;
    setLoading(true);
    setError(null);
    try {
      await postReplan({ job_id: jobId, scenes: fullScenes, timeline: fullTimeline, scene_idx: scene.idx });
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePickAI = async (pickIndex: number) => {
    if (!jobId) return;
    setBusyPickIndex(pickIndex);
    setError(null);
    try {
      await postReplan({
        job_id: jobId,
        scenes: fullScenes,
        timeline: fullTimeline,
        scene_idx: scene.idx,
        pick_index: pickIndex,
      });
    } catch (err) {
      setError(String(err));
    } finally {
      setBusyPickIndex(null);
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
  const sceneBusy = loading || busyPickIndex !== null;
  const excludeForScenePicker = picks.map((p) => String(p.segment_id ?? "")).filter(Boolean);

  return (
    <div className={`scene-block ${blockMods}`} data-scene-idx={scene.idx}>
      <div className="scene-head">
        <span className="scene-id">
          סצינה {scene.idx + 1} · <span className="scene-time">{range}</span>
        </span>
        <span className={`scene-kind-pill ${kindClass}`}>{kindLabel}</span>
        <div className="scene-actions">
          <button
            type="button"
            className="scene-actions__btn scene-actions__btn--ai"
            data-reroll-scene={scene.idx}
            disabled={sceneBusy || !jobId}
            onClick={handleReplan}
            title="החלף את כל הקליפים בסצינה באמצעות AI"
          >
            {loading ? "⟳ מחפש…" : "✨ החלף עם AI"}
          </button>
          <button
            type="button"
            className="scene-actions__btn scene-actions__btn--manual"
            disabled={sceneBusy || !jobId}
            onClick={() => setPickerOpen({ mode: "scene-fill" })}
            title="בחר קליפ מהקטלוג ידנית"
          >
            📁 בחר ידנית
          </button>
        </div>
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
          <div className="scene-empty-msg">אין קליפים — לחץ &quot;✨ החלף עם AI&quot; או &quot;📁 בחר ידנית&quot;</div>
        ) : (
          picks.map((p, i) => {
            const id = String(p.segment_id ?? p.video_id ?? "?");
            const pickRange = `${formatTime(Number(p.video_start ?? 0), 1)}–${formatTime(Number(p.video_end ?? 0), 1)}`;
            const poster = segmentPosterUrl(p as { segment_id?: unknown; video_id?: unknown });
            const why = pickDisplayReason(p);
            const isBusy = busyPickIndex === i;
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
                  {why != null && (
                    <div className="scene-pick-reason">{why}</div>
                  )}
                </div>
                <div className="scene-pick__actions">
                  <button
                    type="button"
                    className="scene-pick__action scene-pick__action--ai"
                    aria-label="החלף קליפ זה עם AI"
                    title="החלף קליפ זה עם AI"
                    disabled={sceneBusy || !jobId}
                    onClick={() => handlePickAI(i)}
                  >
                    {isBusy ? "⟳" : "✨"}
                  </button>
                  <button
                    type="button"
                    className="scene-pick__action scene-pick__action--manual"
                    aria-label="בחר קליפ זה ידנית"
                    title="בחר קליפ זה ידנית"
                    disabled={sceneBusy || !jobId}
                    onClick={() => setPickerOpen({ mode: "pick-swap", pickIndex: i })}
                  >
                    📁
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
      {pickerOpen && jobId && (
        <CatalogPickerModal
          scene={scene}
          jobId={jobId}
          scenes={fullScenes}
          timeline={fullTimeline}
          mode={pickerOpen.mode}
          pickIndex={pickerOpen.pickIndex}
          pick={pickerOpen.pickIndex != null ? picks[pickerOpen.pickIndex] : picks[0]}
          excludeSegmentIds={
            pickerOpen.mode === "pick-swap" && pickerOpen.pickIndex != null
              ? picks.filter((_, i) => i !== pickerOpen.pickIndex).map((p) => String(p.segment_id ?? "")).filter(Boolean)
              : excludeForScenePicker
          }
          onClose={() => setPickerOpen(null)}
          onCommitted={(data: { timeline: TimelinePick[]; validator: Record<string, unknown> }) =>
            onReplan({
              scenes: fullScenes,
              timeline: data.timeline as unknown as Record<string, unknown>[],
              validator: data.validator,
            })
          }
        />
      )}
    </div>
  );
}
