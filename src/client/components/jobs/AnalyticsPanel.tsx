"use client";

import { useMemo } from "react";
import type { HistoryEntry } from "@/client/hooks/useLocalHistory";
import type { JobUsageSummary, UsageCallRecord } from "@/shared/usage";

function num(n: number | undefined): number {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function usd(n: number): string {
  return `$${n.toFixed(4)}`;
}

function aggregate(jobs: HistoryEntry[]) {
  let jobsWithUsage = 0;
  let totalUsd = 0;
  let llmUsd = 0;
  let transUsd = 0;
  let inTok = 0;
  let outTok = 0;
  let audioSec = 0;
  const byModel = new Map<string, { inTok: number; outTok: number }>();
  const byDay = new Map<string, { cost: number; jobs: number }>();

  for (const j of jobs) {
    const s = j.usage_summary as JobUsageSummary | undefined;
    if (!s) continue;
    jobsWithUsage += 1;
    totalUsd += num(s.total_cost_usd_estimate);
    llmUsd += num(s.llm_cost_usd_estimate);
    transUsd += num(s.transcription_cost_usd_estimate);
    inTok += num(s.input_tokens);
    outTok += num(s.output_tokens);
    audioSec += num(s.transcription_billed_audio_sec);

    const day = j.created_at.slice(0, 10);
    const dayRow = byDay.get(day) ?? { cost: 0, jobs: 0 };
    dayRow.cost += num(s.total_cost_usd_estimate);
    dayRow.jobs += 1;
    byDay.set(day, dayRow);

    const calls = (j.usage_calls as UsageCallRecord[] | undefined) ?? [];
    for (const c of calls) {
      const key = `${c.provider}:${c.model}`;
      const cur = byModel.get(key) ?? { inTok: 0, outTok: 0 };
      cur.inTok += c.input_tokens;
      cur.outTok += c.output_tokens;
      byModel.set(key, cur);
    }
  }

  const modelRows = [...byModel.entries()].sort((a, b) => b[1].inTok + b[1].outTok - (a[1].inTok + a[1].outTok));
  const dayRows = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return {
    jobsWithUsage,
    totalUsd,
    llmUsd,
    transUsd,
    inTok,
    outTok,
    audioSec,
    modelRows,
    dayRows,
    pricingRevision: jobs.find((j) => j.usage_summary?.pricing_revision)?.usage_summary?.pricing_revision,
  };
}

interface AnalyticsPanelProps {
  hidden?: boolean;
  jobs: HistoryEntry[];
}

export function AnalyticsPanel({ hidden, jobs }: AnalyticsPanelProps) {
  const stats = useMemo(() => aggregate(jobs), [jobs]);

  return (
    <section
      className="tab-panel"
      id="panel-analytics"
      role="tabpanel"
      aria-labelledby="tab-analytics"
      data-tab-panel="analytics"
      hidden={hidden}
    >
      <header className="catalog-bar">
        <div className="catalog-bar-left">
          <h2 className="catalog-title">אנליטיקת שימוש</h2>
          <span className="catalog-progress" dir="ltr">
            {stats.jobsWithUsage} jobs with usage data (estimates, not invoices)
          </span>
        </div>
      </header>

      {stats.jobsWithUsage === 0 ? (
        <p className="jobs-empty">אין עדיין נתוני שימוש. לאחר תמלול ותכנון יופיעו סכומים משוערים.</p>
      ) : (
        <div className="analytics-panel-main" dir="ltr">
          <div className="settings-stat-grid analytics-stat-grid">
            <div className="settings-stat-card settings-stat-card--analytics">
              <div className="settings-stat-card-top">
                <span>Jobs with usage</span>
              </div>
              <strong>{stats.jobsWithUsage}</strong>
              <small>Rollup from local history</small>
            </div>
            <div className="settings-stat-card settings-stat-card--analytics">
              <div className="settings-stat-card-top">
                <span>Total cost (est.)</span>
              </div>
              <strong>{usd(stats.totalUsd)}</strong>
              <small>LLM + transcription</small>
            </div>
            <div className="settings-stat-card settings-stat-card--analytics">
              <div className="settings-stat-card-top">
                <span>LLM (est.)</span>
              </div>
              <strong>{usd(stats.llmUsd)}</strong>
              <small>From usage_calls pricing</small>
            </div>
            <div className="settings-stat-card settings-stat-card--analytics">
              <div className="settings-stat-card-top">
                <span>Transcription (est.)</span>
              </div>
              <strong>{usd(stats.transUsd)}</strong>
              <small>Whisper / billed audio</small>
            </div>
            <div className="settings-stat-card settings-stat-card--analytics">
              <div className="settings-stat-card-top">
                <span>LLM tokens</span>
              </div>
              <strong>
                in {stats.inTok.toLocaleString()} · out {stats.outTok.toLocaleString()}
              </strong>
              <small>Aggregated job summaries</small>
            </div>
            <div className="settings-stat-card settings-stat-card--analytics">
              <div className="settings-stat-card-top">
                <span>Billed audio</span>
              </div>
              <strong>{stats.audioSec.toFixed(1)}s</strong>
              <small>Transcription metering</small>
            </div>
          </div>

          {stats.pricingRevision && (
            <p className="analytics-pricing-revision">
              pricing_revision: <span className="analytics-pricing-revision__val">{stats.pricingRevision}</span>
            </p>
          )}

          <h3 className="analytics-section-title">LLM by provider:model</h3>
          <ul className="jobs-list">
            {stats.modelRows.map(([key, v]) => (
              <li key={key} className="job-row job-row--static">
                <span className="job-preview">{key}</span>
                <span className="job-meta">
                  in {v.inTok.toLocaleString()} · out {v.outTok.toLocaleString()}
                </span>
              </li>
            ))}
          </ul>

          <h3 className="analytics-section-title">By day (created_at)</h3>
          <ul className="jobs-list">
            {stats.dayRows.map(([day, v]) => (
              <li key={day} className="job-row job-row--static">
                <span className="job-preview">{day}</span>
                <span className="job-meta">
                  {v.jobs} jobs · {usd(v.cost)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
