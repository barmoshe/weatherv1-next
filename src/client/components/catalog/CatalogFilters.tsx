"use client";

import { useMemo } from "react";
import { useTagCounts } from "@/client/hooks/useCatalog";
import { labelFor } from "@/client/lib/tag-labels";
import { SOURCE_VALUES } from "@/server/tag-vocab";

export type SortOrder = "newest" | "oldest" | "duration_asc" | "duration_desc" | "name";

export interface FilterState {
  search: string;
  activeTags: string[];
  activeSource: string | null;
  untaggedOnly: boolean;
  multiSegmentOnly: boolean;
  sort: SortOrder;
}

interface CatalogFiltersProps {
  filters: FilterState;
  onChange: (patch: Partial<FilterState>) => void;
  totalCount: number;
  filteredCount: number;
  multiSegmentCount: number;
}

export function CatalogFilters({
  filters,
  onChange,
  totalCount,
  filteredCount,
  multiSegmentCount,
}: CatalogFiltersProps) {
  const { data: tagData } = useTagCounts();

  const untaggedCount = useMemo(() => {
    return tagData?.untagged ?? 0;
  }, [tagData]);

  const sortedTags = useMemo(() => {
    if (!tagData) return [];
    const merged = { ...tagData.counts, ...tagData.segment_counts };
    return Object.entries(merged)
      .sort((a, b) => b[1] - a[1] || labelFor(a[0]).localeCompare(labelFor(b[0]), "he"))
      .slice(0, 32);
  }, [tagData]);

  const sourceCounts = tagData?.source_counts ?? {};

  function toggleTag(tag: string) {
    const next = filters.activeTags.includes(tag)
      ? filters.activeTags.filter((t) => t !== tag)
      : [...filters.activeTags, tag];
    onChange({ activeTags: next });
  }

  const hasFilters =
    filters.activeTags.length > 0 ||
    filters.activeSource !== null ||
    filters.untaggedOnly ||
    filters.multiSegmentOnly;

  return (
    <details
      className="catalog-filters"
      id="catalog-filters"
      aria-label="מסננים"
      open={hasFilters || undefined}
    >
      <summary className="catalog-filters-summary">
        <span>מסננים</span>
        <span className="catalog-filters-count">
          {filteredCount} מתוך {totalCount}
        </span>
      </summary>

      <div className="catalog-filters-body">
        <div className="filter-section filter-section--quick" aria-label="סינון מהיר">
          <button
            type="button"
            className="filter-chip"
            aria-pressed={filters.multiSegmentOnly}
            onClick={() => onChange({ multiSegmentOnly: !filters.multiSegmentOnly })}
          >
            2+ מקטעים
            <span className="chip-count">{multiSegmentCount}</span>
          </button>
          <button
            type="button"
            className="filter-chip filter-untagged"
            id="filter-untagged-only"
            aria-pressed={filters.untaggedOnly}
            onClick={() => onChange({ untaggedOnly: !filters.untaggedOnly })}
          >
            לא מתויגים
            <span className="chip-count" id="filter-untagged-count">{untaggedCount}</span>
          </button>
        </div>

        <section className="filter-section" aria-label="מקור">
          <h3 className="filter-section-title">מקור</h3>
          <div className="filter-options filter-options--inline">
            {SOURCE_VALUES.map((source) => (
              <button
                key={source}
                type="button"
                className="filter-option"
                onClick={() => onChange({ activeSource: filters.activeSource === source ? null : source })}
                aria-pressed={filters.activeSource === source}
              >
                <span>{labelFor(source)}</span>
                <span className="chip-count">{sourceCounts[source] ?? 0}</span>
              </button>
            ))}
          </div>
        </section>

        {sortedTags.length > 0 && (
          <section className="filter-section" aria-label="תגיות נפוצות">
            <h3 className="filter-section-title">תגיות נפוצות</h3>
            <div className="filter-options filter-options--inline">
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
          </section>
        )}

        {hasFilters && (
          <button
            type="button"
            className="btn btn--ghost btn--sm filter-clear"
            id="filter-clear"
            onClick={() =>
              onChange({
                activeTags: [],
                activeSource: null,
                untaggedOnly: false,
                multiSegmentOnly: false,
              })
            }
          >
            נקה הכל
          </button>
        )}
      </div>
    </details>
  );
}
