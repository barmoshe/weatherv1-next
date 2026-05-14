"use client";

import type { DotVariant, DesktopStatus } from "./settingsTypes";
import { SettingsStatCard, shortPath } from "./settingsShared";

interface SettingsOverviewPanelProps {
  healthLoading: boolean;
  catalogKnown: boolean;
  claimed: number;
  catalogDotVariant: DotVariant;
  catalogStatHint: string;
  desktopLoading: boolean;
  isDesktop: boolean;
  workspaceReady: boolean;
  workspaceDir?: string | null;
  configuredKeysCount: number;
  r2Ready: boolean;
  desktopR2?: DesktopStatus["r2"];
}

export function SettingsOverviewPanel({
  healthLoading,
  catalogKnown,
  claimed,
  catalogDotVariant,
  catalogStatHint,
  desktopLoading,
  isDesktop,
  workspaceReady,
  workspaceDir,
  configuredKeysCount,
  r2Ready,
  desktopR2,
}: SettingsOverviewPanelProps) {
  return (
    <section className="settings-overview" aria-label="תקציר הגדרות">
      <div>
        <p className="settings-eyebrow">WeatherV1 Control Center</p>
        <p className="settings-intro">
          בדיקה מהירה של מצב הקטלוג, הדסקטופ, מפתחות ה-AI והסנכרון לענן לפני שינוי הגדרות.
        </p>
      </div>
      <div className="settings-stat-grid">
        <SettingsStatCard
          label="קטלוג"
          value={
            healthLoading ? (
              "טוען…"
            ) : catalogKnown ? (
              <>
                <bdi>{claimed}</bdi> קליפים בקטלוג
              </>
            ) : (
              "ממתין"
            )
          }
          dotVariant={
            healthLoading || !catalogKnown ? "warn" : catalogDotVariant
          }
          hint={healthLoading || !catalogKnown ? "בודק קטלוג" : catalogStatHint}
        />
        <SettingsStatCard
          label="דסקטופ"
          value={
            desktopLoading
              ? "טוען…"
              : isDesktop
                ? workspaceReady
                  ? "מוכן"
                  : "דורש בדיקה"
                : "לא פעיל"
          }
          dotVariant={isDesktop && workspaceReady ? "ok" : "danger"}
          hint={
            isDesktop ? shortPath(workspaceDir) : "פתח דרך Electron"
          }
        />
        <SettingsStatCard
          label="AI"
          value={<span dir="ltr">{configuredKeysCount}/3</span>}
          dotVariant={configuredKeysCount > 0 ? "ok" : "danger"}
          hint={
            configuredKeysCount > 0
              ? "מפתח אחד לפחות מוגדר"
              : "צריך מפתח לתכנון"
          }
        />
        <SettingsStatCard
          label="R2"
          value={
            r2Ready
              ? "מחובר"
              : desktopR2?.enabled
                ? "חסר פרטים"
                : "כבוי"
          }
          dotVariant={r2Ready ? "ok" : "danger"}
          hint={
            desktopR2?.lastSyncAt
              ? `סונכרן ${desktopR2.lastSyncAt}`
              : "טרם סונכרן"
          }
        />
      </div>
    </section>
  );
}
