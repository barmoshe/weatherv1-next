"use client";
import { useState, useEffect, useCallback } from "react";

export interface HistoryEntry {
  job_id: string;
  created_at: string;
  audio_filename?: string;
  transcript_preview?: string;
  duration_sec?: number;
  output_url?: string;
  status: string;
}

const KEY = "weatherv1.history";
const MAX_ENTRIES = 50;
export const ACTIVE_JOB_STATUSES = new Set(["draft", "queued", "processing"]);
export const HISTORY_JOB_STATUSES = new Set(["completed", "failed", "lost"]);

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
  for (const entry of local) {
    byId.set(entry.job_id, entry);
  }
  for (const entry of persisted) {
    const existing = byId.get(entry.job_id);
    byId.set(entry.job_id, {
      ...existing,
      ...entry,
      transcript_preview: existing?.transcript_preview ?? entry.transcript_preview,
      duration_sec: existing?.duration_sec ?? entry.duration_sec,
    });
  }

  return Array.from(byId.values())
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
    .slice(0, MAX_ENTRIES);
}

export function useLocalHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    let cancelled = false;
    const local = load();
    setHistory(local);

    (async () => {
      try {
        const res = await fetch("/api/jobs");
        if (!res.ok) return;
        const data = (await res.json()) as JobsResponse;
        if (!data.success || !Array.isArray(data.jobs)) return;
        if (cancelled) return;
        setHistory((prev) => {
          const next = mergeHistoryEntries(prev, data.jobs ?? []);
          save(next);
          return next;
        });
      } catch {
        // Local browser history is still usable if the server-side import fails.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

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

  const removeEntry = useCallback((jobId: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.job_id !== jobId);
      save(next);
      return next;
    });
    void fetch(`/api/jobs/${jobId}`, { method: "DELETE" }).catch(() => {
      // The local row is removed immediately; a failed server delete can be
      // retried by refreshing and deleting the re-imported row.
    });
  }, []);

  return { history, addEntry, updateEntry, removeEntry };
}
