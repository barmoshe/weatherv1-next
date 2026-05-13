"use client";
import type { HistoryEntry } from "@/client/hooks/useLocalHistory";
import type { JobUsageSummary } from "@/shared/usage";
import { formatRelativeTime, formatDuration } from "@/client/lib/format-time";

interface JobRowProps {
  entry: HistoryEntry;
  lane: "active" | "history";
  onRestore?: (entry: HistoryEntry) => void;
  onDelete?: (jobId: string) => void;
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

export function JobRow({ entry, lane, onRestore, onDelete }: JobRowProps) {
  const dotClass = `is-${entry.status || "queued"}`;
  const tag = STATUS_TAG_HE[entry.status];
  const relTime = formatRelativeTime(entry.created_at);
  const dur = entry.duration_sec ? formatDuration(entry.duration_sec) : "";

  const handleActivate = () => onRestore?.(entry);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onRestore?.(entry);
    }
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
      <span className={`job-status-dot ${dotClass}`} aria-hidden="true" />
      <span className="job-preview">
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
    </li>
  );
}
