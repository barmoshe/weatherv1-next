"use client";
import { useQuery } from "@tanstack/react-query";

export interface JobStatus {
  status: "draft" | "queued" | "processing" | "completed" | "failed";
  output_url?: string | null;
  error?: string | null;
}

export function useJobStatus(jobId: string | null, enabled = true) {
  return useQuery<JobStatus>({
    queryKey: ["job-status", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/status/${jobId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { status: string; output_url?: string | null; error?: string | null };
      return data as JobStatus;
    },
    enabled: !!jobId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || status === "completed" || status === "failed") return false;
      return 2000;
    },
    staleTime: 0,
  });
}
