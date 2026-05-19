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

function FolderIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  );
}

export function SceneCard({ scene, picks, jobId, fullTimeline, fullScenes, validator, onReplan }: SceneCardProps) {
  const [pickerOpen, setPickerOpen] = useState<PickerState | null>(null);

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
            className="scene-actions__btn"
            disabled={!jobId}
            onClick={() => setPickerOpen({ mode: "scene-fill" })}
            title="בחר קליפ מהקטלוג ידנית"
          >
            <FolderIcon />
            בחר ידנית
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
      <div className="scene-picks">
        {picks.length === 0 ? (
          <div className="scene-empty-msg">אין קליפים — לחץ &quot;בחר ידנית&quot; להוספת קליפ</div>
        ) : (
          picks.map((p, i) => {
            const id = String(p.segment_id ?? p.video_id ?? "?");
            const pickRange = `${formatTime(Number(p.video_start ?? 0), 1)}–${formatTime(Number(p.video_end ?? 0), 1)}`;
            const poster = segmentPosterUrl(p as { segment_id?: unknown; video_id?: unknown });
            const why = pickDisplayReason(p);
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
                    className="scene-pick__action"
                    aria-label="בחר קליפ זה ידנית"
                    title="בחר קליפ זה ידנית"
                    disabled={!jobId}
                    onClick={() => setPickerOpen({ mode: "pick-swap", pickIndex: i })}
                  >
                    <FolderIcon />
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
