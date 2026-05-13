import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CatalogFilters, type FilterState } from "@/client/components/catalog/CatalogFilters";

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const filters: FilterState = {
  search: "",
  activeTags: [],
  activeSource: null,
  activeAvailability: null,
  untaggedOnly: false,
  multiSegmentOnly: false,
  sort: "newest",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CatalogFilters", () => {
  it("uses server multi-segment stats for the 2+ segments chip", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({
      success: true,
      counts: {},
      segment_counts: {},
      source_counts: {},
      total: 212,
      total_clips: 212,
      total_segments: 408,
      multi_segment_clips: 28,
      single_segment_clips: 184,
      clips_with_no_segments: 0,
      remote_available_clips: 212,
      remote_missing_clips: 0,
      cached_local_clips: 11,
      not_cached_local_clips: 201,
      cloud_only_clips: 201,
      syncing_clips: 0,
      error_clips: 0,
      untagged: 0,
    })));

    render(
      <CatalogFilters
        filters={filters}
        onChange={vi.fn()}
        totalCount={212}
        filteredCount={212}
        multiSegmentCount={0}
      />,
      { wrapper },
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /2\+ מקטעים\s+28/ })).toBeInTheDocument();
    });
  });
});
