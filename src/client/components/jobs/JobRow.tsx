"use client";
import type { HistoryEntry } from "@/client/hooks/useLocalHistory";
import type { JobUsageSummary } from "@/shared/usage";
import { formatRelativeTime, formatDuration } from "@/client/lib/format-time";
import { ErrorBanner } from "@/client/components/common/ErrorBanner";
import { JobDots } from "./JobDots";
import { buildJobTimeline } from "@/client/lib/jobTimeline";
import { stepLabelHe } from "@/client/lib/step-labels";

interface JobRowProps {
  entry: HistoryEntry;
  lane: "active" | "history";
  onRestore?: (entry: HistoryEntry) => void;
  onDelete?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRetryRender?: (jobId: string) => void;
}

const STATUS_TAG_HE: Record<string, string> = {
  draft: "טיוטה",
  queued: "בתור",
  processing: "מרנדר",
  completed: "הושלם",
  failed: "נכשל",
  cancelled: "בוטל",
  interrupted: "מתחדש",
  lost: "לא נמצא",
};

function usageShort(s: JobUsageSummary): string {
  const total = s.total_cost_usd_estimate ?? 0;
  const inT = s.input_tokens ?? 0;
  const outT = s.output_tokens ?? 0;
  return `~$${total.toFixed(3)} · ${inT}/${outT} tok`;
}

export function JobRow({ entry, lane, onRestore, onDelete, onCancel, onRetryRender }: JobRowProps) {
  const dotClass = `is-${entry.status || "queued"}`;
  const tag = STATUS_TAG_HE[entry.status];
  const relTime = formatRelativeTime(entry.created_at);
  const dur = entry.duration_sec ? formatDuration(entry.duration_sec) : "";
  const isFailure = entry.status === "failed" || entry.status === "lost";
  // Retry covers genuine render failures and user cancellations. Planning-step
  // failures resolve via the studio replan flow (the retry route returns
  // resume:"plan"), so they're still routed through onRetryRender.
  const canRetry =
    !!onRetryRender &&
    ((entry.status === "failed" && (!entry.failed_step || entry.failed_step === "render")) ||
      entry.status === "cancelled");
  const canCancel = !!onCancel && (entry.status === "queued" || entry.status === "processing");
  const isRendering = entry.status === "processing";
  const pct =
    typeof entry.progress === "number" ? Math.max(0, Math.min(1, entry.progress)) : null;
  const stepLabel = stepLabelHe(entry.failed_step);
  const failureSummary = isFailure && (entry.error || entry.error_code)
    ? `${stepLabel ? `${stepLabel}: ` : ""}${entry.error ?? entry.error_code ?? ""}`
    : undefined;
  const dotSteps = buildJobTimeline({
    usage_calls: entry.usage_calls,
    usage_summary: entry.usage_summary,
    failed_step: entry.failed_step,
    status: entry.status,
  });
  const queuePos = entry.status === "queued" ? entry.queue_position ?? null : null;
  const showSub = dotSteps.length > 0 || isRendering || !!failureSummary;

  const handleActivate = (e: React.MouseEvent) => {
    // Don't restore when the click landed in the failure disclosure or sub-row controls.
    if ((e.target as HTMLElement | null)?.closest(".job-row__failure, .job-row__sub")) return;
    onRestore?.(entry);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    if ((e.target as HTMLElement | null)?.closest(".job-row__failure, .job-row__sub")) return;
    e.preventDefault();
    onRestore?.(entry);
  };

  return (
    <li
      className="job-row"
      role="button"
      tabIndex={0}
      data-job={entry.job_id}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
    >
      <span
        className={`job-status-dot ${dotClass}`}
        aria-hidden="true"
        title={failureSummary}
      />
      <span className="job-preview" title={failureSummary}>
        {entry.transcript_preview || entry.job_id}
      </span>
      <span className="job-meta">
        {tag && (
          <>
            <span className="job-tag">{tag}</span>
            {queuePos !== null && <span className="job-queue-pos">{` · #${queuePos}`}</span>}
            {" · "}
          </>
        )}
        <span>{relTime}</span>
        {dur && (
          <>
            {" · "}
            <span className="duration">{dur}</span>
          </>
        )}
        {entry.usage_summary && (
          <>
            {" · "}
            <span className="duration" dir="ltr">
              {usageShort(entry.usage_summary)}
            </span>
          </>
        )}
      </span>
      <span className="job-row__actions">
        {canCancel && (
          <button
            type="button"
            className="job-cancel"
            aria-label="בטל"
            data-cancel={entry.job_id}
            onClick={(e) => {
              e.stopPropagation();
              onCancel?.(entry.job_id);
            }}
          >
            עצור
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="job-delete"
            aria-label="מחק"
            data-delete={entry.job_id}
            onClick={(e) => {
              e.stopPropagation();
              onDelete?.(entry.job_id);
            }}
          >
            ×
          </button>
        )}
      </span>
      {showSub && (
        <div className="job-row__sub" onClick={(e) => e.stopPropagation()}>
          {dotSteps.length > 0 && <JobDots steps={dotSteps} />}
          {isRendering && pct !== null && (
            <div className="job-row__progress" role="progressbar" aria-valuenow={Math.round(pct * 100)} aria-valuemin={0} aria-valuemax={100}>
              <span className="job-row__progress-fill" style={{ width: `${pct * 100}%` }} />
              <span className="job-row__progress-label" dir="ltr">
                {Math.round(pct * 100)}%
                {typeof entry.eta_sec === "number" && entry.eta_sec > 0
                  ? ` · ~${formatDuration(entry.eta_sec)}`
                  : ""}
              </span>
            </div>
          )}
          {failureSummary && (
            <div className="job-row__failure-line">
              <span className="job-row__failure-text" title={failureSummary}>
                {failureSummary}
              </span>
              {canRetry && (
                <button
                  type="button"
                  className="job-row__retry"
                  data-retry={entry.job_id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetryRender!(entry.job_id);
                  }}
                >
                  נסה שוב
                </button>
              )}
            </div>
          )}
          {isFailure && (entry.error || entry.error_code) && (
            <details className="job-row__failure">
              <summary className="job-row__failure-summary">פרטי שגיאה</summary>
              <ErrorBanner
                compact
                error={{
                  message: entry.error ?? entry.error_code ?? "שגיאה",
                  code: entry.error_code,
                  provider: entry.error_provider,
                  consoleUrl: entry.error_console_url,
                  step: entry.failed_step,
                  at: entry.failed_at,
                }}
              />
            </details>
          )}
        </div>
      )}
    </li>
  );
}
