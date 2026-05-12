"use client";
import { JobRow } from "./JobRow";
import { HISTORY_JOB_STATUSES, type HistoryEntry } from "@/client/hooks/useLocalHistory";

interface HistoryPanelProps {
  hidden?: boolean;
  jobs: HistoryEntry[];
  onRestore?: (entry: HistoryEntry) => void;
  onRemove?: (jobId: string) => void;
}

export function HistoryPanel({ hidden, jobs, onRestore, onRemove }: HistoryPanelProps) {
  const done = jobs.filter((j) => HISTORY_JOB_STATUSES.has(j.status));
  const handleClearAll = () => {
    if (!onRemove) return;
    if (!window.confirm("לנקות את כל ההיסטוריה?")) return;
    done.forEach((j) => onRemove(j.job_id));
  };
  return (
    <section
      className="tab-panel"
      id="panel-history"
      role="tabpanel"
      aria-labelledby="tab-history"
      data-tab-panel="history"
      hidden={hidden}
    >
      <ul className="jobs-list" id="history-list">
        {done.length === 0 ? (
          <li className="jobs-empty">אין היסטוריה עדיין · רינדורים יישמרו אוטומטית.</li>
        ) : (
          done.map((j) => (
            <JobRow
              key={j.job_id}
              entry={j}
              lane="history"
              onRestore={onRestore}
              onDelete={onRemove}
            />
          ))
        )}
      </ul>
      <div className="tab-panel-footer">
        <button
          id="clear-history"
          className="btn btn--ghost"
          type="button"
          onClick={handleClearAll}
        >
          ניקוי הכל
        </button>
      </div>
    </section>
  );
}
