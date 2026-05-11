"use client";
import { useEffect, useState } from "react";

interface CatalogHealth {
  loaded_count?: number;
  claimed_count?: number;
  missing_ids?: string[];
  version?: string;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [health, setHealth] = useState<CatalogHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);

  const loadHealth = async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const r = await fetch("/api/catalog/health");
      const data = await r.json() as { success: boolean; health?: CatalogHealth; error?: string };
      if (!data.success) throw new Error(data.error ?? "שגיאה");
      setHealth(data.health ?? {});
    } catch (e) {
      setHealthError(e instanceof Error ? e.message : String(e));
    } finally {
      setHealthLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) loadHealth();
  }, [isOpen]);

  if (!isOpen) return null;

  const loaded = health?.loaded_count ?? 0;
  const claimed = health?.claimed_count ?? 0;
  const missing = health?.missing_ids ?? [];
  const ver = health?.version ? health.version.slice(0, 8) : "?";
  const healthy = missing.length === 0;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog">
        <header className="modal-header">
          <h2 className="modal-title" id="settings-title">הגדרות</h2>
          <button
            className="modal-close"
            type="button"
            aria-label="סגור"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="modal-body">
          <section className="settings-section">
            <div className="settings-section-header">
              <h3>קטלוג קליפים</h3>
              <button
                type="button"
                className="settings-link"
                onClick={loadHealth}
                disabled={healthLoading}
              >
                רענן
              </button>
            </div>
            <p className="settings-hint">
              מצב הקטלוג בשרת — כמה כניסות מתוך הרשימה הוגדרו עם קובץ וידאו אמיתי על הדיסק.
            </p>
            <div id="catalog-status">
              {healthLoading && (
                <div className="catalog-card">
                  <span className="dot is-healthy" style={{ opacity: 0.4 }} />
                  <span>טוען...</span>
                </div>
              )}
              {!healthLoading && healthError && (
                <div className="catalog-card">
                  <span className="dot is-missing" />
                  <span>שגיאה בטעינת מצב הקטלוג: {healthError}</span>
                </div>
              )}
              {!healthLoading && !healthError && health && (
                <>
                  <div className="catalog-card">
                    <span className={`dot ${healthy ? "is-healthy" : "is-missing"}`} />
                    <span>
                      <span className="count">{loaded}/{claimed}</span> קליפים נטענו
                    </span>
                    <span className="ver">· {ver}</span>
                  </div>
                  {missing.length > 0 && (
                    <div className="catalog-missing-list">
                      <strong>חסרים בדיסק ({missing.length}):</strong> {missing.join(", ")}
                    </div>
                  )}
                </>
              )}
            </div>
          </section>
        </div>
        <footer className="modal-footer">
          <button className="btn btn--ghost" type="button" onClick={onClose}>סגור</button>
        </footer>
      </div>
    </div>
  );
}
