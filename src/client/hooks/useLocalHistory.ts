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

export function useLocalHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);

  useEffect(() => {
    setHistory(load());
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
  }, []);

  return { history, addEntry, updateEntry, removeEntry };
}
