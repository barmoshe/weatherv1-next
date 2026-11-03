"use client";
import { useQuery } from "@tanstack/react-query";

/** Subset of server `R2SyncStatus` needed in the renderer */
export interface DesktopR2Brief {
  enabled: boolean;
  ready: boolean;
  error?: string;
}

export interface DesktopStatusResponse {
  success: boolean;
  desktop_mode: boolean;
  r2?: DesktopR2Brief;
  keys: {
    anthropic_configured: boolean;
  };
  providers: {
    llm_active: "anthropic" | null;
    llm_model: string | null;
    transcription_active: "local-whisper" | null;
  };
  whisper?: WhisperModelBrief;
}

/** Local transcription model state (`/api/desktop/status` and `/api/whisper`). */
export interface WhisperModelBrief {
  state: "missing" | "downloading" | "ready" | "error";
  model_id: string;
  bytes_done: number;
  bytes_total: number;
  error?: string;
  binary_found: boolean;
}

export function useDesktopStatus(enabled = true) {
  return useQuery<DesktopStatusResponse | null>({
    queryKey: ["desktop-status"],
    queryFn: async () => {
      const res = await fetch("/api/desktop/status");
      if (res.status === 403) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DesktopStatusResponse;
    },
    enabled,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });
}
