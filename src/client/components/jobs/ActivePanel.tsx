"use client";
import { JobRow } from "./JobRow";
import { ACTIVE_JOB_STATUSES, type HistoryEntry } from "@/client/hooks/useLocalHistory";

interface ActivePanelProps {
  hidden?: boolean;
  jobs: HistoryEntry[];
  onRestore?: (entry: HistoryEntry) => void;
  onRemove?: (jobId: string) => void;
  onExportJobsJson?: () => void;
}

export function ActivePanel({ hidden, jobs, onRestore, onRemove, onExportJobsJson }: ActivePanelProps) {
  const active = jobs.filter((j) => ACTIVE_JOB_STATUSES.has(j.status));
  return (
    <section
      className="tab-panel"
      id="panel-active"
      role="tabpanel"
      aria-labelledby="tab-active"
      data-tab-panel="active"
      hidden={hidden}
    >
      <ul className="jobs-list" id="active-list">
        {active.length === 0 ? (
          <li className="jobs-empty">אין רינדורים פעילים.</li>
        ) : (
          active.map((j) => (
            <JobRow
              key={j.job_id}
              entry={j}
              lane="active"
              onRestore={onRestore}
              onDelete={onRemove}
            />
          ))
        )}
      </ul>
      {onExportJobsJson ? (
        <div className="tab-panel-footer">
          <button
            id="export-jobs-json-active"
            className="btn btn--secondary btn--sm"
            type="button"
            onClick={onExportJobsJson}
          >
            Export JSON
          </button>
        </div>
      ) : null}
    </section>
  );
}
