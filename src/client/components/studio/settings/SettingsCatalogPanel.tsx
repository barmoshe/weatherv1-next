"use client";

import type { CatalogHealth } from "./settingsTypes";
import type { DotVariant } from "./settingsTypes";
import { StatusDot } from "./settingsShared";

interface SettingsCatalogPanelProps {
  onRefreshHealth: () => void;
  healthLoading: boolean;
  healthError: string | null;
  health: CatalogHealth | null;
  claimed: number;
  missing: string[];
  ver: string;
  onDiskCount: number;
  catalogDotVariant: DotVariant;
}

export function SettingsCatalogPanel({
  onRefreshHealth,
  healthLoading,
  healthError,
  health,
  claimed,
  missing,
  ver,
  onDiskCount,
  catalogDotVariant,
}: SettingsCatalogPanelProps) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>קטלוג קליפים</h3>
        <button
          type="button"
          className="settings-link"
          onClick={onRefreshHealth}
          disabled={healthLoading}
        >
          רענן
        </button>
      </div>
      <p className="settings-hint">
        <strong>שורות בקטלוג</strong> — כמה קליפים מוגדרים ב־{' '}
        <span dir="ltr" lang="en" className="settings-ltr-seg">
          catalog
        </span>{' '}
        (מטא-דאטה ומקטעים).{' '}
        <strong>קבצי מקור במטמון</strong> — האם קובץ הווידאו המלא קיים בתיקיית הווידאו של סביבת העבודה.
      </p>
      <p className="settings-hint">
        כש־<span dir="ltr" className="settings-ltr-seg">R2</span> מחובר, הרנדר יכול למשוך את קובץ המקור מהענן לתיקייה זמנית לצורך החיתוך — מטמון מקומי מלא אינו תנאי לרנדר.
      </p>
      <div id="catalog-status">
        {healthLoading && (
          <div className="catalog-card">
            <span className="dot is-healthy is-muted" />
            <span>טוען…</span>
          </div>
        )}
        {!healthLoading && healthError && (
          <div className="catalog-card">
            <span className="dot is-missing" />
            <span>
              שגיאה בטעינת מצב הקטלוג:{' '}
              <span dir="ltr" lang="en" className="settings-ltr-snippet">
                {healthError}
              </span>
            </span>
          </div>
        )}
        {!healthLoading && !healthError && health && (
          <>
            <div className="catalog-card catalog-card--multiline">
              <StatusDot variant={catalogDotVariant} />
              <div className="catalog-card__lines" dir="rtl">
                <div className="catalog-card__line">
                  <span className="count">
                    <bdi>{claimed}</bdi>
                  </span>{' '}
                  קליפים בקטלוג
                  <span className="ver" dir="ltr" lang="en">
                    {' '}
                    · {ver}
                  </span>
                </div>
                <div className="catalog-card__sub">
                  <bdi>{onDiskCount}</bdi> מתוך <bdi>{claimed}</bdi> קבצי מקור במטמון המקומי
                </div>
              </div>
            </div>
            {missing.length > 0 && (
              <details className="catalog-missing-details">
                <summary className="catalog-missing-summary">
                  <span className="catalog-missing-summary__he">
                    חסרים במטמון (<bdi>{missing.length}</bdi>) — לחץ להרחבה
                  </span>
                  <span dir="ltr" lang="en" className="catalog-missing-preview">
                    {missing.slice(0, 6).join(', ')}
                    {missing.length > 6 ? '…' : ''}
                  </span>
                </summary>
                <div className="catalog-missing-list-scroll" dir="ltr" lang="en">
                  {missing.join(', ')}
                </div>
              </details>
            )}
          </>
        )}
      </div>
    </section>
  );
}
