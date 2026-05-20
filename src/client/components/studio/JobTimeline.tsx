"use client";

import { useMemo } from "react";
import type { JobUsageSummary, UsageCallRecord } from "@/shared/usage";
import { buildJobTimeline, formatCostUsd } from "@/client/lib/jobTimeline";

interface JobTimelineProps {
  usage_calls?: UsageCallRecord[];
  usage_summary?: JobUsageSummary;
  failed_step?: string | null;
  status?: string;
}

export function JobTimeline({
  usage_calls,
  usage_summary,
  failed_step,
  status,
}: JobTimelineProps) {
  const steps = useMemo(
    () => buildJobTimeline({ usage_calls, usage_summary, failed_step, status }),
    [usage_calls, usage_summary, failed_step, status],
  );
  if (steps.length === 0) return null;

  return (
    <div className="job-timeline" aria-label="צעדי הפקה">
      <div className="job-timeline__title">צעדי הפקה</div>
      {steps.map((step) => {
        const cost = formatCostUsd(step.cost_usd);
        return (
          <div
            key={step.kind}
            className={`job-timeline__row${step.failed ? " is-failed" : ""}`}
          >
            <span className="job-timeline__step">{step.label}</span>
            <span className="job-timeline__meta">
              {step.attempts != null && step.attempts > 1 && (
                <span className="job-timeline__chip">{step.attempts} ניסיונות</span>
              )}
              {typeof step.billed_audio_sec === "number" && step.billed_audio_sec > 0 && (
                <span className="job-timeline__chip" dir="ltr">
                  {step.billed_audio_sec.toFixed(0)}s audio
                </span>
              )}
              {typeof step.input_tokens === "number" && (step.input_tokens > 0 || step.output_tokens) && (
                <span className="job-timeline__chip" dir="ltr">
                  {step.input_tokens}/{step.output_tokens ?? 0} tok
                </span>
              )}
              {cost && (
                <span className="job-timeline__chip job-timeline__cost" dir="ltr">
                  {cost}
                </span>
              )}
              {step.failed && <span className="job-timeline__chip">נכשל</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}
