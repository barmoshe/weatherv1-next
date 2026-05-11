"use client";
import { useState } from "react";
import type { TileState } from "./StudioPanel";
import type { Scene } from "@/shared/types";

interface WhyPanelProps {
  tileState: TileState;
  hidden?: boolean;
  timeline: Record<string, unknown>[];
  validator: Record<string, unknown>;
  scenes: Scene[];
}

export function WhyPanel({ tileState, hidden, timeline, validator, scenes }: WhyPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const health = validator.catalog_health as Record<string, unknown> | undefined;
  const hardFixed = (validator.hard_violations_fixed as unknown[]) ?? [];
  const hardKept = (validator.hard_violations_kept as unknown[]) ?? [];
  const warnings = (validator.warnings as unknown[]) ?? [];
  const score = Number(validator.score ?? 100);

  const sceneMap = new Map(scenes.map((s) => [s.idx, s]));

  return (
    <section
      className={`tile tile--diag step ${tileState}`}
      id="step-why"
      data-area="diag"
      data-expanded={String(expanded)}
      aria-label="אבחון"
      hidden={hidden}
    >
      <header
        className="tile-header"
        id="diag-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls="why-table"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
      >
        <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="11" cy="11" r="7"/>
          <path d="m20 20-3.5-3.5"/>
        </svg>
        <span className="step-title">למה הקליפים האלה?</span>
        <span className="diag-summary">
          <span id="diag-clipcount">{timeline.length > 0 ? timeline.length : "—"}</span> קליפים
          {" · "}
          <span id="diag-health">{timeline.length > 0 ? `ציון ${score}` : "—"}</span>
        </span>
        <span className="status-pill">אבחון</span>
        <svg className="icon diag-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </header>
      <div className="tile-body step-content diag-body">
        <div id="catalog-health">
          {health && (
            <>
              <span>קליפים: {String(health.loaded_clips ?? health.loaded ?? "—")}</span>
              <span>קטעים: {String(health.loaded_segments ?? "—")}</span>
              <span>ציון: {score}</span>
              {hardFixed.length > 0 && <span className="badge badge--warn">תוקנו: {hardFixed.length}</span>}
              {hardKept.length > 0 && <span className="badge badge--error">הפרות: {hardKept.length}</span>}
              {warnings.length > 0 && <span className="badge">אזהרות: {warnings.length}</span>}
            </>
          )}
        </div>
        <table id="why-table">
          <thead>
            <tr>
              <th>#</th>
              <th>סצינה</th>
              <th>אודיו</th>
              <th>קליפ וידאו</th>
              <th>סיבה</th>
              <th>סימונים</th>
            </tr>
          </thead>
          <tbody id="why-tbody">
            {timeline.map((p, i) => {
              const sIdx = p.scene_idx as number | undefined;
              const scene = sIdx != null ? sceneMap.get(sIdx) : undefined;
              const aStart = Number(p.audio_start ?? 0).toFixed(1);
              const aEnd = Number(p.audio_end ?? 0).toFixed(1);
              return (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{scene ? `${sIdx! + 1}. ${scene.title_he}` : sIdx != null ? String(sIdx + 1) : "—"}</td>
                  <td dir="ltr">{aStart}–{aEnd}</td>
                  <td dir="ltr">{String(p.segment_id ?? p.video_id ?? "—")}</td>
                  <td>{String(p.reason ?? "—")}</td>
                  <td></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <details className="raw-toggle">
          <summary>JSON מקורי</summary>
          <pre id="why-raw">{JSON.stringify({ timeline, validator }, null, 2)}</pre>
        </details>
      </div>
    </section>
  );
}
