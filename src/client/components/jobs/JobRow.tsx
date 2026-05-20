"use client";
import type { HistoryEntry } from "@/client/hooks/useLocalHistory";
import type { JobUsageSummary } from "@/shared/usage";
import { formatRelativeTime, formatDuration } from "@/client/lib/format-time";
import { ErrorBanner } from "@/client/components/common/ErrorBanner";
import { stepLabelHe } from "@/client/lib/step-labels";

interface JobRowProps {
  entry: HistoryEntry;
  lane: "active" | "history";
  onRestore?: (entry: HistoryEntry) => void;
  onDelete?: (jobId: string) => void;
  onRetryRender?: (jobId: string) => void;
}

const STATUS_TAG_HE: Record<string, string> = {
  draft: "טיוטה",
  queued: "בתור",
  processing: "מרנדר",
  completed: "הושלם",
  failed: "נכשל",
  lost: "לא נמצא",
};

function usageShort(s: JobUsageSummary): string {
  const total = s.total_cost_usd_estimate ?? 0;
  const inT = s.input_tokens ?? 0;
  const outT = s.output_tokens ?? 0;
  return `~$${total.toFixed(3)} · ${inT}/${outT} tok`;
}

export function JobRow({ entry, lane, onRestore, onDelete, onRetryRender }: JobRowProps) {
  const dotClass = `is-${entry.status || "queued"}`;
  const tag = STATUS_TAG_HE[entry.status];
  const relTime = formatRelativeTime(entry.created_at);
  const dur = entry.duration_sec ? formatDuration(entry.duration_sec) : "";
  const isFailure = entry.status === "failed" || entry.status === "lost";
  const canRetryRender =
    !!onRetryRender && entry.status === "failed" && entry.failed_step === "render";
  const stepLabel = stepLabelHe(entry.failed_step);
  const failureSummary = isFailure && (entry.error || entry.error_code)
    ? `${stepLabel ? `${stepLabel}: ` : ""}${entry.error ?? entry.error_code ?? ""}`
    : undefined;

  const handleActivate = (e: React.MouseEvent) => {
    // Don't restore when the click landed inside the failure details disclosure.
    if ((e.target as HTMLElement | null)?.closest(".job-row__failure")) return;
    onRestore?.(entry);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Same bail-out for keyboard activations.
    if ((e.target as HTMLElement | null)?.closest(".job-row__failure")) return;
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
      {onDelete ? (
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
      ) : (
        <span aria-hidden="true" />
      )}
      {isFailure && (entry.error || entry.error_code) && (
        <details
          className="job-row__failure"
          onClick={(e) => e.stopPropagation()}
        >
          <summary className="job-row__failure-summary">
            הצג פרטי שגיאה
          </summary>
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
            onRetry={canRetryRender ? () => onRetryRender!(entry.job_id) : undefined}
          />
        </details>
      )}
    </li>
  );
}
