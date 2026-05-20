"use client";
import { JobRow } from "./JobRow";
import {
  ACTIVE_JOB_STATUSES,
  HISTORY_JOB_STATUSES,
  type HistoryEntry,
} from "@/client/hooks/useLocalHistory";

interface JobsPanelProps {
  hidden?: boolean;
  jobs: HistoryEntry[];
  onRestore?: (entry: HistoryEntry) => void;
  onRemove?: (jobId: string) => void;
  onCancel?: (jobId: string) => void;
  onRetryRender?: (jobId: string) => void;
}

export function JobsPanel({
  hidden,
  jobs,
  onRestore,
  onRemove,
  onCancel,
  onRetryRender,
}: JobsPanelProps) {
  const active = jobs.filter((j) => ACTIVE_JOB_STATUSES.has(j.status));
  const history = jobs.filter((j) => HISTORY_JOB_STATUSES.has(j.status));

  const handleClearAll = () => {
    if (!onRemove) return;
    if (!window.confirm("לנקות את כל ההיסטוריה?")) return;
    history.forEach((j) => onRemove(j.job_id));
  };

  return (
    <section
      className="tab-panel"
      id="panel-jobs"
      role="tabpanel"
      aria-labelledby="tab-jobs"
      data-tab-panel="jobs"
      hidden={hidden}
    >
      {active.length > 0 && (
        <div className="jobs-section">
          <h2 className="jobs-section__title">פעילים</h2>
          <ul className="jobs-list" id="active-list">
            {active.map((j) => (
              <JobRow
                key={j.job_id}
                entry={j}
                lane="active"
                onRestore={onRestore}
                onDelete={onRemove}
                onCancel={onCancel}
                onRetryRender={onRetryRender}
              />
            ))}
          </ul>
        </div>
      )}

      <div className="jobs-section">
        <h2 className="jobs-section__title">היסטוריה</h2>
        <ul className="jobs-list" id="history-list">
          {history.length === 0 ? (
            <li className="jobs-empty">
              {active.length === 0
                ? "אין רינדורים עדיין · התחל בסטודיו."
                : "אין היסטוריה עדיין · רינדורים יישמרו אוטומטית."}
            </li>
          ) : (
            history.map((j) => (
              <JobRow
                key={j.job_id}
                entry={j}
                lane="history"
                onRestore={onRestore}
                onDelete={onRemove}
                onRetryRender={onRetryRender}
              />
            ))
          )}
        </ul>
        {history.length > 0 && (
          <div className="tab-panel-footer">
            <button id="clear-history" className="btn btn--ghost" type="button" onClick={handleClearAll}>
              ניקוי הכל
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
