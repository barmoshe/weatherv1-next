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
        <div className="catalog-layout" style={{ padding: "0.75rem 0" }}>
          <div className="catalog-main" dir="ltr">
            <p style={{ margin: "0 0 0.5rem", fontSize: "0.9rem" }}>
              Totals (LLM tokens + Whisper audio): in {stats.inTok.toLocaleString()} · out{" "}
              {stats.outTok.toLocaleString()} · audio {stats.audioSec.toFixed(1)}s
            </p>
            <p style={{ margin: "0 0 0.5rem" }}>
              Cost (est.): total {usd(stats.totalUsd)} · LLM {usd(stats.llmUsd)} · transcription{" "}
              {usd(stats.transUsd)}
            </p>
            {stats.pricingRevision && (
              <p style={{ margin: "0 0 1rem", opacity: 0.75, fontSize: "0.85rem" }}>
                pricing_revision: {stats.pricingRevision}
              </p>
            )}

            <h3 style={{ fontSize: "1rem", margin: "0.75rem 0 0.35rem" }}>LLM by provider:model</h3>
            <ul className="jobs-list">
              {stats.modelRows.map(([key, v]) => (
                <li key={key} className="job-row" style={{ cursor: "default" }}>
                  <span className="job-preview">{key}</span>
                  <span className="job-meta">
                    in {v.inTok.toLocaleString()} · out {v.outTok.toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>

            <h3 style={{ fontSize: "1rem", margin: "0.75rem 0 0.35rem" }}>By day (created_at)</h3>
            <ul className="jobs-list">
              {stats.dayRows.map(([day, v]) => (
                <li key={day} className="job-row" style={{ cursor: "default" }}>
                  <span className="job-preview">{day}</span>
                  <span className="job-meta">
                    {v.jobs} jobs · {usd(v.cost)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
