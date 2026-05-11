"use client";
import { useQuery } from "@tanstack/react-query";
import type { ParsedVideo } from "@/shared/types";

export function useCatalog() {
  return useQuery<ParsedVideo[]>({
    queryKey: ["catalog"],
    queryFn: async () => {
      const res = await fetch("/api/catalog");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json() as { videos?: ParsedVideo[] };
      return data.videos ?? [];
    },
    staleTime: 30_000,
  });
}

export function useTagCounts() {
  return useQuery<{ tags: Record<string, number>; sources: Record<string, number> }>({
    queryKey: ["tag-counts"],
    queryFn: async () => {
      const res = await fetch("/api/catalog/tag-counts");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json() as Promise<{ tags: Record<string, number>; sources: Record<string, number> }>;
    },
    staleTime: 30_000,
  });
}
