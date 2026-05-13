"use client";
import { useState, useEffect, useCallback, useRef } from "react";

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
  const historyRef = useRef<HistoryEntry[]>(history);

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
    historyRef.current = history;
  }, [history]);

  useEffect(() => {
    const ac = new AbortController();
    setHistory(load());
    void syncFromServer(ac.signal);
    return () => ac.abort();
  }, [syncFromServer]);

  // Jobs list updates from many places (worker, APIs). Studio only polls `/api/status`
  // for the current transcript job — keep dashboard rows (Active/History tabs) aligned.
  useEffect(() => {
    const hasActive = history.some((j) => ACTIVE_JOB_STATUSES.has(j.status));
    if (!hasActive) return;
    const id = window.setInterval(() => void syncFromServer(), 2000);
    return () => window.clearInterval(id);
  }, [history, syncFromServer]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return;
      const h = historyRef.current;
      if (!h.some((j) => ACTIVE_JOB_STATUSES.has(j.status))) return;
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
