"use client";
import { useState } from "react";
import type { TileState } from "./StudioPanel";
import type { Scene } from "@/shared/types";
import type { JobUsageSummary, UsageCallRecord } from "@/shared/usage";
import { pickDisplayReason } from "@/client/lib/plan-pick-display";
import { JobTimeline } from "./JobTimeline";

interface WhyPanelProps {
  tileState: TileState;
  hidden?: boolean;
  timeline: Record<string, unknown>[];
  validator: Record<string, unknown>;
  scenes: Scene[];
  usage_calls?: UsageCallRecord[];
  usage_summary?: JobUsageSummary;
  failed_step?: string | null;
  job_status?: string;
}

function scoreTone(score: number): "is-good" | "is-warn" | "is-bad" {
  if (score >= 90) return "is-good";
  if (score >= 70) return "is-warn";
  return "is-bad";
}

export function WhyPanel({
  tileState,
  hidden,
  timeline,
  validator,
  scenes,
  usage_calls,
  usage_summary,
  failed_step,
  job_status,
}: WhyPanelProps) {
  const [expanded, setExpanded] = useState(false);

  const health = validator.catalog_health as Record<string, unknown> | undefined;
  const hardFixed = (validator.hard_violations_fixed as unknown[]) ?? [];
  const hardKept = (validator.hard_violations_kept as unknown[]) ?? [];
  const warnings = (validator.warnings as unknown[]) ?? [];
  const score = Number(validator.score ?? 100);

  const sceneMap = new Map(scenes.map((s) => [s.idx, s]));
  const hasTimeline = timeline.length > 0;

  return (
    <section
      className={`tile tile--diag step ${tileState}`}
      id="step-why"
      data-area="diag"
      data-expanded={String(expanded)}
      aria-labelledby="why-title"
      hidden={hidden}
    >
      <header
        className="tile-header"
        id="diag-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls="why-body"
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") setExpanded((v) => !v); }}
      >
        <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/>
          <path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 1.5-2.5 2-2.5 3.5"/>
          <circle cx="12" cy="17" r="0.6" fill="currentColor"/>
        </svg>
        <span className="step-title" id="why-title">למה הקליפים האלה?</span>
        <span className="diag-summary">
          <span id="diag-clipcount">{hasTimeline ? timeline.length : "—"}</span> קליפים
          {" · "}
          <span id="diag-health" className={hasTimeline ? scoreTone(score) : undefined}>
            {hasTimeline ? `ציון ${score}` : "—"}
          </span>
        </span>
        <span className="status-pill">אבחון</span>
        <svg className="icon diag-chevron" viewBox="0 0 24 24" aria-hidden="true">
          <path d="m6 9 6 6 6-6"/>
        </svg>
      </header>
      <div className="tile-body step-content diag-body" id="why-body">
        {health && (
          <div id="catalog-health">
            <span className="why-badge">קליפים: {String(health.loaded_clips ?? health.loaded ?? "—")}</span>
            <span className="why-badge">קטעים: {String(health.loaded_segments ?? "—")}</span>
            <span className={`why-badge why-badge--score ${scoreTone(score)}`}>ציון: {score}</span>
            {hardFixed.length > 0 && <span className="why-badge why-badge--warn">תוקנו: {hardFixed.length}</span>}
            {hardKept.length > 0 && <span className="why-badge why-badge--error">הפרות: {hardKept.length}</span>}
            {warnings.length > 0 && <span className="why-badge why-badge--note">אזהרות: {warnings.length}</span>}
          </div>
        )}
        <table id="why-table">
          <thead>
            <tr>
              <th>#</th>
              <th>סצינה</th>
              <th>אודיו</th>
              <th>קליפ וידאו</th>
              <th>סיבה</th>
            </tr>
          </thead>
          <tbody id="why-tbody">
            {!hasTimeline && (
              <tr>
                <td colSpan={5} className="why-empty">אין עדיין נתוני פילוח להציג.</td>
              </tr>
            )}
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
                  <td className="reason-cell">{pickDisplayReason(p as Record<string, unknown>) ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <JobTimeline
          usage_calls={usage_calls}
          usage_summary={usage_summary}
          failed_step={failed_step}
          status={job_status}
        />
        {hasTimeline && (
          <details className="raw-toggle">
            <summary>JSON מקורי</summary>
            <pre id="why-raw">{JSON.stringify({ timeline, validator }, null, 2)}</pre>
          </details>
        )}
      </div>
    </section>
  );
}
