"use client";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";

export type Tab = "studio" | "jobs" | "catalog" | "analytics";
const VALID_TABS: Tab[] = ["studio", "jobs", "catalog", "analytics"];

/** Legacy tab ids (the old split Active/History tabs) → the merged Jobs tab. */
const LEGACY_TAB_ALIASES: Record<string, Tab> = { active: "jobs", history: "jobs" };

function buildQueryString(params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `?${qs}` : "?";
}

export function useTabFromUrl(): [Tab, (tab: Tab) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const raw = searchParams.get("tab");
  const aliased = raw ? LEGACY_TAB_ALIASES[raw] : undefined;
  const tab: Tab = aliased ?? (VALID_TABS.includes(raw as Tab) ? (raw as Tab) : "studio");

  const setTab = useCallback(
    (next: Tab) => {
      // Read live URL to avoid stale searchParams when combined with other setters
      const params = new URLSearchParams(window.location.search);
      if (next === "studio") {
        params.delete("tab");
      } else {
        params.set("tab", next);
      }
      router.replace(buildQueryString(params), { scroll: false });
    },
    [router],
  );

  return [tab, setTab];
}

export function useJobFromUrl(): [string | null, (jobId: string | null) => void] {
  const searchParams = useSearchParams();
  const router = useRouter();
  const jobId = searchParams.get("job");

  const setJobId = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(window.location.search);
      if (next) {
        params.set("job", next);
      } else {
        params.delete("job");
      }
      router.replace(buildQueryString(params), { scroll: false });
    },
    [router],
  );

  return [jobId, setJobId];
}

/**
 * Set tab and job in a single URL update. Use this when changing both at once
 * (e.g., clicking a history row should switch to studio AND set the job).
 */
export function useUrlParams() {
  const router = useRouter();
  return useCallback(
    (patch: { tab?: Tab | null; job?: string | null }) => {
      const params = new URLSearchParams(window.location.search);
      if (patch.tab !== undefined) {
        if (patch.tab === null || patch.tab === "studio") {
          params.delete("tab");
        } else {
          params.set("tab", patch.tab);
        }
      }
      if (patch.job !== undefined) {
        if (patch.job === null) {
          params.delete("job");
        } else {
          params.set("job", patch.job);
        }
      }
      router.replace(buildQueryString(params), { scroll: false });
    },
    [router],
  );
}
