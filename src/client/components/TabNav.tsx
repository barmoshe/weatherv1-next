"use client";
import type { Tab } from "@/client/hooks/useTabFromUrl";

interface TabNavProps {
  activeTab: Tab;
  onTabChange: (tab: Tab) => void;
  activeBadge?: number;
  historyBadge?: number;
  catalogBadge?: number;
}

const TABS: { id: Tab; label: string; badgeId: string }[] = [
  { id: "studio", label: "סטודיו", badgeId: "" },
  { id: "active", label: "פעילים", badgeId: "badge-active" },
  { id: "history", label: "היסטוריה", badgeId: "badge-history" },
  { id: "catalog", label: "קטלוג", badgeId: "badge-catalog" },
];

export function TabNav({ activeTab, onTabChange, activeBadge, historyBadge, catalogBadge }: TabNavProps) {
  const badgeMap: Record<string, number | undefined> = {
    active: activeBadge,
    history: historyBadge,
    catalog: catalogBadge,
  };

  return (
    <nav className="tab-nav" role="tablist" aria-label="ניווט ראשי">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          data-tab={t.id}
          aria-controls={`panel-${t.id}`}
          aria-selected={activeTab === t.id}
          className={activeTab === t.id ? "is-active" : undefined}
          onClick={() => onTabChange(t.id)}
        >
          {t.label}
          {t.badgeId && (
            <span
              className="badge"
              id={t.badgeId}
              hidden={!badgeMap[t.id] || badgeMap[t.id] === 0}
            >
              {badgeMap[t.id] ?? 0}
            </span>
          )}
        </button>
      ))}
    </nav>
  );
}
