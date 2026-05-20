"use client";
import { useQuery } from "@tanstack/react-query";

export interface JobStatus {
  status: "draft" | "queued" | "processing" | "completed" | "failed" | "lost";
  output_url?: string | null;
  error?: string | null;
  error_code?: string | null;
  error_provider?: string | null;
  error_console_url?: string | null;
  failed_step?: string | null;
  failed_at?: string | null;
}

export function useJobStatus(jobId: string | null, enabled = true) {
  return useQuery<JobStatus>({
    queryKey: ["job-status", jobId],
    queryFn: async () => {
      const res = await fetch(`/api/status/${jobId}`);
      if (res.status === 404) {
        return { status: "lost", output_url: null, error: "Job not found", error_code: "job_lost" };
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as JobStatus;
      return data;
    },
    enabled: !!jobId && enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      if (!status || status === "completed" || status === "failed" || status === "lost") return false;
      return 2000;
    },
    staleTime: 0,
  });
}
