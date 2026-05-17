"use client";
import { useState, useEffect, useCallback } from "react";
import type { JobUsageSummary, UsageCallRecord } from "@/shared/usage";

export interface HistoryEntry {
  job_id: string;
  created_at: string;
  audio_filename?: string;
  transcript_preview?: string;
  duration_sec?: number;
  output_url?: string;
  status: string;
  usage_summary?: JobUsageSummary;
  usage_calls?: UsageCallRecord[];
}

const KEY = "weatherv1.history";
const MAX_ENTRIES = 50;
export const ACTIVE_JOB_STATUSES = new Set(["draft", "queued", "processing"]);
export const HISTORY_JOB_STATUSES = new Set(["completed", "failed", "lost"]);

/** Cross-component cue (catalog pull, R2 bootstrap, settings actions) to refresh /api/jobs. */
export const REFETCH_JOBS_EVENT = "weatherv1-refetch-jobs";
export function dispatchRefetchJobs(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(REFETCH_JOBS_EVENT));
}

/** Poll cadences (per polling research): fast during processing, slow when idle. */
const ACTIVE_POLL_MS = 2_000;
const IDLE_POLL_MS = 30_000;

interface JobsResponse {
  success?: boolean;
  jobs?: HistoryEntry[];
}

function load(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as HistoryEntry[];
  } catch {
    return [];
  }
}

function save(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
}

export function mergeHistoryEntries(local: HistoryEntry[], persisted: HistoryEntry[]): HistoryEntry[] {
  const byId = new Map<string, HistoryEntry>();
  const persistedIds = new Set(persisted.map((p) => p.job_id));
  for (const entry of local) {
    if (persistedIds.has(entry.job_id)) byId.set(entry.job_id, entry);
  }
  for (const entry of persisted) {
    const existing = byId.get(entry.job_id);
    byId.set(entry.job_id, {
      ...existing,
      ...entry,
      transcript_preview: existing?.transcript_preview ?? entry.transcript_preview,
      duration_sec: existing?.duration_sec ?? entry.duration_sec,
      usage_summary: entry.usage_summary ?? existing?.usage_summary,
      usage_calls: entry.usage_calls ?? existing?.usage_calls,
    });
  }

  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_ENTRIES);
}

export function useLocalHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  const syncFromServer = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/jobs", { signal });
      if (!res.ok) return;
      const data = (await res.json()) as JobsResponse;
      if (!data.success || !Array.isArray(data.jobs)) return;
      setHistory((prev) => {
        const next = mergeHistoryEntries(prev, data.jobs ?? []);
        save(next);
        return next;
      });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      // Local browser history is still usable if the server-side import fails.
    }
  }, []);

  useEffect(() => {
    const ac = new AbortController();
    setHistory(load());
    void syncFromServer(ac.signal);
    return () => ac.abort();
  }, [syncFromServer]);

  useEffect(() => {
    const onRefetch = () => void syncFromServer();
    window.addEventListener(REFETCH_JOBS_EVENT, onRefetch);
    return () => window.removeEventListener(REFETCH_JOBS_EVENT, onRefetch);
  }, [syncFromServer]);

  // Adaptive cadence: fast while something is processing, slow when idle.
  // The slow tick keeps the list in sync with cloud-side state (another
  // machine deleting a job, `Pull from R2` truncating jobs.json) without
  // hammering the gateway. Skip the fetch when the tab is hidden —
  // visibilitychange catches us up on return. Depending on `hasActive`
  // (not `history`) means the interval only resets when the cadence flips.
  const hasActive = history.some((j) => ACTIVE_JOB_STATUSES.has(j.status));
  useEffect(() => {
    const id = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void syncFromServer();
    }, hasActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => window.clearInterval(id);
  }, [hasActive, syncFromServer]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      // Always catch up on return — the slow ambient tick may have missed
      // cloud-side mutations while the tab was backgrounded.
      void syncFromServer();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [syncFromServer]);

  const addEntry = useCallback((entry: HistoryEntry) => {
    setHistory((prev) => {
      const next = [entry, ...prev.filter((e) => e.job_id !== entry.job_id)];
      save(next);
      return next;
    });
  }, []);

  const updateEntry = useCallback((jobId: string, patch: Partial<HistoryEntry>) => {
    setHistory((prev) => {
      const next = prev.map((e) => (e.job_id === jobId ? { ...e, ...patch } : e));
      save(next);
      return next;
    });
  }, []);

  const removeEntry = useCallback(
    (jobId: string) => {
      setHistory((prev) => {
        const next = prev.filter((e) => e.job_id !== jobId);
        save(next);
        return next;
      });
      void fetch(`/api/jobs/${jobId}`, { method: "DELETE" })
        .then((res) => {
          if (res.ok) return syncFromServer();
        })
        .catch(() => {
          // Local row removed; optional follow-up poll will heal drift.
        });
    },
    [syncFromServer],
  );

  return { history, addEntry, updateEntry, removeEntry, syncFromServer };
}
