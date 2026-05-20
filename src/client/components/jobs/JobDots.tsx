"use client";
import type { TimelineStep } from "@/client/lib/jobTimeline";

interface JobDotsProps {
  steps: TimelineStep[];
}

/**
 * Compact lifecycle indicator — one dot per pipeline step the job actually
 * reached (transcribe → scene_planner → picker → render), reusing the same
 * derivation as the studio JobTimeline. The failed step is marked red.
 */
export function JobDots({ steps }: JobDotsProps) {
  if (steps.length === 0) return null;

  return (
    <span className="job-row__dots" aria-hidden="true">
      {steps.map((s) => (
        <span
          key={s.kind}
          className={`job-row__dot${s.failed ? " is-failed" : ""}`}
          title={s.label}
        />
      ))}
    </span>
  );
}
