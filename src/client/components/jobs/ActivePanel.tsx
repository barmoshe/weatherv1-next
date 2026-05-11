"use client";
import { JobRow } from "./JobRow";
import type { HistoryEntry } from "@/client/hooks/useLocalHistory";

interface ActivePanelProps {
  hidden?: boolean;
  jobs: HistoryEntry[];
  onRestore?: (entry: HistoryEntry) => void;
}

const ACTIVE_STATUSES = new Set(["draft", "queued", "processing"]);

export function ActivePanel({ hidden, jobs, onRestore }: ActivePanelProps) {
  const active = jobs.filter((j) => ACTIVE_STATUSES.has(j.status));
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
            />
          ))
        )}
      </ul>
    </section>
  );
}
