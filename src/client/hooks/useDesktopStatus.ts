"use client";
import { useQuery } from "@tanstack/react-query";

export interface DesktopStatusResponse {
  success: boolean;
  desktop_mode: boolean;
  keys: {
    openai_configured: boolean;
    anthropic_configured: boolean;
    gemini_configured: boolean;
  };
  providers: {
    llm_pref: string;
    llm_active: "anthropic" | "openai" | null;
    llm_model: string | null;
    transcription_active: "openai-cloud" | null;
  };
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
