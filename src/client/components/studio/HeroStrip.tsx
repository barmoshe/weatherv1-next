"use client";
import type { StudioPhase } from "./StudioPanel";
import { formatDuration, formatRelativeTime } from "@/client/lib/format-time";

interface HeroStripProps {
  jobId: string | null;
  phase: StudioPhase;
  phaseIndex: number;
  filename?: string;
  duration?: number;
  createdAt?: string | null;
}

const PHASE_TO_STATUS: Record<StudioPhase, string> = {
  upload: "pending",
  transcribing: "active",
  transcribed: "completed",
  planning: "active",
  planned: "completed",
  rendering: "active",
  done: "completed",
  failed: "failed",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "ממתין להעלאה",
  active: "מעבד",
  completed: "הושלם",
  failed: "נכשל",
  waiting: "בתור",
};

function FileIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}
function DurationIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
      <path d="M12 2v3" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}

export function HeroStrip({ jobId, phase, phaseIndex, filename, duration, createdAt }: HeroStripProps) {
  const status = PHASE_TO_STATUS[phase];
  const label = STATUS_LABELS[status] ?? "—";

  return (
    <header className="dash-hero" id="dash-hero" aria-label="פרטי ההפקה">
      <div className="hero-meta">
        <span className="hero-title">סטודיו</span>
        <span className="hero-jobid" id="hero-jobid" dir="ltr">
          {jobId ? `#${jobId.slice(0, 8)}` : ""}
        </span>
        <span className={`hero-status-pill is-${status}`} id="hero-status">
          {label}
        </span>
      </div>
      <div className="hero-stats">
        <span id="hero-filename" className="hero-stat">
          {filename && (<><FileIcon />{filename}</>)}
        </span>
        <span id="hero-duration" className="hero-stat">
          {duration ? (<><DurationIcon />{formatDuration(duration)}</>) : null}
        </span>
        <span id="hero-created" className="hero-stat">
          {createdAt && (<><ClockIcon />{formatRelativeTime(createdAt)}</>)}
        </span>
      </div>
      <div
        className="seg-bar"
        id="seg-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={phaseIndex}
        aria-label="התקדמות הפקה"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`seg${phaseIndex > i ? " done" : phaseIndex === i && phase !== "upload" ? " active" : ""}`}>
            <span className="fill" />
          </div>
        ))}
      </div>
    </header>
  );
}

