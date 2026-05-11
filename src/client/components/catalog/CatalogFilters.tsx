"use client";

import { useMemo } from "react";
import { useTagCounts } from "@/client/hooks/useCatalog";
import { labelFor } from "@/client/lib/tag-labels";

export type SortOrder = "newest" | "oldest" | "duration_asc" | "duration_desc" | "name";

export interface FilterState {
  search: string;
  activeTags: string[];
  activeSource: string | null;
  untaggedOnly: boolean;
  sort: SortOrder;
}

interface CatalogFiltersProps {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  totalCount: number;
  filteredCount: number;
}

export function CatalogFilters({ filters, onChange, totalCount, filteredCount }: CatalogFiltersProps) {
  const { data: tagData } = useTagCounts();

  const untaggedCount = useMemo(() => {
    if (!tagData) return 0;
    return ((tagData as Record<string, unknown>).untagged_count as number) ?? 0;
  }, [tagData]);

  const sortedTags = useMemo(() => {
    if (!tagData) return [];
    const segCounts = (tagData as Record<string, unknown>).segment_counts as Record<string, number> | undefined;
    const counts = (tagData as Record<string, unknown>).counts as Record<string, number> | undefined;
    const merged = { ...(counts ?? {}), ...(segCounts ?? {}) };
    return Object.entries(merged)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40);
  }, [tagData]);

  function toggleTag(tag: string) {
    const next = filters.activeTags.includes(tag)
      ? filters.activeTags.filter((t) => t !== tag)
      : [...filters.activeTags, tag];
    onChange({ activeTags: next });
  }

  const hasFilters =
    filters.activeTags.length > 0 ||
    filters.activeSource !== null ||
    filters.untaggedOnly;

  return (
    <aside className="catalog-filters" id="catalog-filters" aria-label="מסננים">
      <div className="filter-section">
        <button
          type="button"
          className="filter-chip filter-untagged"
          id="filter-untagged-only"
          aria-pressed={filters.untaggedOnly}
          onClick={() => onChange({ untaggedOnly: !filters.untaggedOnly })}
        >
          הצג לא מתויגים בלבד <span className="chip-count" id="filter-untagged-count">{untaggedCount}</span>
        </button>
      </div>
      <div id="filter-facets">
        {sortedTags.length > 0 && (
          <details className="facet-group" open>
            <summary>תגיות נפוצות</summary>
            <div className="facet-group-body">
              <div className="filter-options">
                {sortedTags.map(([tag, count]) => (
                  <button
                    key={tag}
                    type="button"
                    className="filter-option"
                    onClick={() => toggleTag(tag)}
                    aria-pressed={filters.activeTags.includes(tag)}
                  >
                    <span>{labelFor(tag)}</span>
                    <span className="chip-count">{count}</span>
                  </button>
                ))}
              </div>
            </div>
          </details>
        )}
      </div>
      <div className="filter-section filter-section-actions">
        {hasFilters && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            id="filter-clear"
            onClick={() => onChange({ activeTags: [], activeSource: null, untaggedOnly: false })}
          >
            נקה הכל
          </button>
        )}
      </div>
    </aside>
  );
}
