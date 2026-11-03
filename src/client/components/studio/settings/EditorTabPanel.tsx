"use client";

import type { DesktopAppInfo, DesktopUpdateState } from "@/shared/desktop";

import { SecretField, StatusDot, shortPath } from "./settingsShared";
import type { CatalogHealth, DesktopStatus, DotVariant } from "./settingsTypes";
import { WhisperModelCard } from "./WhisperModelCard";

interface EditorTabPanelProps {
  // Catalog health (prop-drilled from SettingsModal)
  healthLoading: boolean;
  health: CatalogHealth | null;
  claimed: number;
  missing: string[];
  catalogDotVariant: DotVariant;
  catalogStatHint: string;
  // AI: the Claude key + the local transcription model
  desktopStatusKeys: DesktopStatus["keys"];
  whisper?: DesktopStatus["whisper"];
  anthropicKey: string;
  saving: boolean;
  onAnthropicKeyChange: (value: string) => void;
  onClearAnthropic: () => void;
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
  whisper,
  anthropicKey,
  saving,
  onAnthropicKeyChange,
  onClearAnthropic,
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

  const claudeOk = desktopStatusKeys.anthropic_configured;

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
          <StatusDot variant={claudeOk ? "ok" : "danger"} />
        </header>
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          מפתח Claude מפעיל את תכנון הסצנות ובחירת הקליפים. התמלול רץ על המחשב הזה.
        </p>
        <SecretField
          label="מפתח Claude"
          value={anthropicKey}
          configured={claudeOk}
          placeholder={claudeOk ? "מפתח שמור במחסנית המפתחות" : "sk-ant-…"}
          disabled={saving}
          onValueChange={onAnthropicKeyChange}
          onClear={onClearAnthropic}
        />
        <WhisperModelCard initial={whisper} />
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
