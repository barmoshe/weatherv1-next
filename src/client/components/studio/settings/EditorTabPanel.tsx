"use client";

import type { DesktopAppInfo, DesktopUpdateState } from "@/shared/desktop";

import { SecretField, StatusDot, shortPath } from "./settingsShared";
import type { CatalogHealth, DesktopStatus, DotVariant } from "./settingsTypes";

interface EditorTabPanelProps {
  // Catalog health (prop-drilled from SettingsModal)
  healthLoading: boolean;
  health: CatalogHealth | null;
  claimed: number;
  missing: string[];
  catalogDotVariant: DotVariant;
  catalogStatHint: string;
  // AI: only the OpenAI key surfaces here
  desktopStatusKeys: DesktopStatus["keys"];
  openaiKey: string;
  saving: boolean;
  onOpenaiKeyChange: (value: string) => void;
  onClearOpenai: () => void;
  // Workspace (read-only mirror)
  workspaceDir: string | null | undefined;
  workspaceReady: boolean;
  // App + updates
  appInfo: DesktopAppInfo | null;
  updateState: DesktopUpdateState | null;
  onCheckForUpdates: () => void;
  // Switch to admin tab for anything that's not exposed here
  onSwitchToAdminTab: () => void;
}

function describeUpdateState(state: DesktopUpdateState | null): string {
  if (!state) return "—";
  switch (state.status) {
    case "checking":
      return "בודק עדכונים…";
    case "available":
      return "עדכון זמין";
    case "downloading":
      return "מוריד עדכון…";
    case "downloaded":
      return state.detail ? `מוכן להתקנה · ${state.detail}` : "מוכן להתקנה";
    case "idle":
    case "configured":
      return "מעודכן";
    case "error":
      return state.detail ? `שגיאת עדכון · ${state.detail}` : "שגיאת עדכון";
    case "unavailable":
    default:
      return state.detail ?? "לא זמין";
  }
}

export function EditorTabPanel({
  healthLoading,
  health,
  claimed,
  missing,
  catalogDotVariant,
  catalogStatHint,
  desktopStatusKeys,
  openaiKey,
  saving,
  onOpenaiKeyChange,
  onClearOpenai,
  workspaceDir,
  workspaceReady,
  appInfo,
  updateState,
  onCheckForUpdates,
  onSwitchToAdminTab,
}: EditorTabPanelProps) {
  const onDisk = Math.max(0, claimed - missing.length);
  const libraryLine = (() => {
    if (healthLoading && !health) return "טוען מצב קטלוג…";
    if (!health) return "מצב קטלוג לא זמין";
    if (catalogDotVariant === "ok") return `הספרייה מוכנה · ${onDisk} קליפים`;
    if (catalogDotVariant === "warn")
      return `הספרייה מוכנה לעבודה · ${onDisk}/${claimed} קליפים זמינים מקומית`;
    return `בעיה בקטלוג · ${missing.length} מקטעים חסרים`;
  })();

  const openaiOk = desktopStatusKeys.openai_configured;

  return (
    <div className="settings-editor-tab" dir="rtl">
      <section className="settings-section">
        <header className="settings-section-header">
          <h3>הספרייה</h3>
          <StatusDot variant={catalogDotVariant} />
        </header>
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          {libraryLine}
        </p>
        {catalogStatHint && catalogStatHint !== libraryLine ? (
          <small className="settings-hint">{catalogStatHint}</small>
        ) : null}
      </section>

      <section className="settings-section">
        <header className="settings-section-header">
          <h3>חיבור AI</h3>
          <StatusDot variant={openaiOk ? "ok" : "danger"} />
        </header>
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          מפתח OpenAI נדרש לתמלול קולי. שאר המפתחות והעדפות נמצאים בטאב הניהול.
        </p>
        <SecretField
          label="מפתח OpenAI (תמלול קולי)"
          value={openaiKey}
          configured={openaiOk}
          placeholder={openaiOk ? "מפתח שמור במחסנית המפתחות" : "sk-…"}
          disabled={saving}
          onValueChange={onOpenaiKeyChange}
          onClear={onClearOpenai}
        />
      </section>

      <section className="settings-section">
        <header className="settings-section-header">
          <h3>תיקיית עבודה</h3>
          <StatusDot variant={workspaceReady ? "ok" : "warn"} />
        </header>
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          <code dir="ltr">{shortPath(workspaceDir)}</code>
        </p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onSwitchToAdminTab}
        >
          שינוי דרך &quot;ניהול&quot; ←
        </button>
      </section>

      <section className="settings-section">
        <header className="settings-section-header">
          <h3>אפליקציה</h3>
        </header>
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          {appInfo
            ? `WeatherV1 · גרסה ${appInfo.appVersion}`
            : "WeatherV1"}
        </p>
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          מצב עדכון: {describeUpdateState(updateState)}
        </p>
        <button
          type="button"
          className="btn btn--ghost"
          onClick={onCheckForUpdates}
        >
          בדיקת עדכונים
        </button>
      </section>
    </div>
  );
}
