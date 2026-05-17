"use client";

import type { DesktopAppInfo, DesktopUpdateState } from "@/shared/desktop";
import type { DesktopStatus } from "./settingsTypes";
import { StatusDot, shortPath } from "./settingsShared";

interface SettingsDesktopPanelProps {
  saved: boolean;
  onRefreshDesktopStatus: () => void;
  desktopLoading: boolean;
  saving: boolean;
  desktopError: string | null;
  desktopStatus: DesktopStatus | null;
  appInfo: DesktopAppInfo | null;
  updateState: DesktopUpdateState | null;
  workspaceReady: boolean;
  ffmpegReady: boolean;
  onPickWorkspace: () => void;
  workspaceDir: string;
  onWorkspaceDirChange: (value: string) => void;
  ffmpegPath: string;
  ffprobePath: string;
  onFfmpegPathChange: (value: string) => void;
  onFfprobePathChange: (value: string) => void;
  onResetWorkspaceToDefault: () => void;
  onClearDerivedCache: () => void;
  clearCacheBusy: boolean;
  onBeginUninstall: () => void;
  onBeginUninstallWithCleanup: () => void;
  uninstallBusy: boolean;
}

export function SettingsDesktopPanel({
  saved,
  onRefreshDesktopStatus,
  desktopLoading,
  saving,
  desktopError,
  desktopStatus,
  appInfo,
  updateState,
  workspaceReady,
  ffmpegReady,
  onPickWorkspace,
  workspaceDir,
  onWorkspaceDirChange,
  ffmpegPath,
  ffprobePath,
  onFfmpegPathChange,
  onFfprobePathChange,
  onResetWorkspaceToDefault,
  onClearDerivedCache,
  clearCacheBusy,
  onBeginUninstall,
  onBeginUninstallWithCleanup,
  uninstallBusy,
}: SettingsDesktopPanelProps) {
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-header">
          <h3>אפליקציית דסקטופ</h3>
          {saved && <span className="settings-saved-pill">נשמר</span>}
          <button
            type="button"
            className="settings-link"
            onClick={onRefreshDesktopStatus}
            disabled={desktopLoading || saving}
          >
            רענן
          </button>
        </div>
        {desktopError && (
          <div className="catalog-card">
            <span className="dot is-missing" />
            <span>
              שגיאה בטעינת מצב הדסקטופ:{' '}
              <span dir="ltr" lang="en" className="settings-ltr-snippet">
                {desktopError}
              </span>
            </span>
          </div>
        )}
        {!desktopError && (
          <div className="settings-status-grid">
            <div className="settings-status-row">
              <StatusDot variant={workspaceReady ? 'ok' : 'danger'} />
              <span>סביבת עבודה</span>
              <code title={desktopStatus?.workspace.workspaceDir}>
                {shortPath(desktopStatus?.workspace.workspaceDir)}
              </code>
            </div>
            <div className="settings-status-row">
              <StatusDot variant={ffmpegReady ? 'ok' : 'danger'} />
              <span>FFmpeg</span>
              <code title={appInfo?.ffmpeg.ffmpegPath ?? undefined}>
                {shortPath(appInfo?.ffmpeg.ffmpegPath)}
              </code>
            </div>
            <div className="settings-status-row">
              <StatusDot
                variant={Boolean(desktopStatus?.keys.anthropic_configured) ? 'ok' : 'danger'}
              />
              <span>Anthropic</span>
              <span>{desktopStatus?.keys.anthropic_configured ? 'מוגדר' : 'לא מוגדר'}</span>
            </div>
            <div className="settings-status-row">
              <StatusDot variant={Boolean(desktopStatus?.keys.openai_configured) ? 'ok' : 'danger'} />
              <span>OpenAI</span>
              <span>{desktopStatus?.keys.openai_configured ? 'מוגדר' : 'לא מוגדר'}</span>
            </div>
            <div className="settings-status-row">
              <StatusDot variant={Boolean(desktopStatus?.keys.gemini_configured) ? 'ok' : 'danger'} />
              <span>Gemini</span>
              <span>{desktopStatus?.keys.gemini_configured ? 'מוגדר' : 'לא מוגדר'}</span>
            </div>
            <div className="settings-status-row">
              <span className="dot is-healthy" />
              <span>גרסה</span>
              <span>
                {appInfo
                  ? `${appInfo.appVersion} · Electron ${appInfo.electronVersion}`
                  : 'טוען…'}
              </span>
            </div>
            <div className="settings-status-row">
              <span className="dot is-healthy" />
              <span>עדכונים</span>
              <span>{updateState ? updateState.status : 'טוען…'}</span>
            </div>
          </div>
        )}
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h3>{appInfo?.packaged ? 'מטמון מקומי' : 'סביבת עבודה ונתיבי FFmpeg'}</h3>
          <button type="button" className="settings-link" onClick={onPickWorkspace} disabled={saving}>
            בחר תיקייה
          </button>
        </div>
        {appInfo?.packaged ? (
          <p className="settings-hint">
            R2 הוא מקור האמת לקטלוג. התיקייה הזו משמשת כמטמון מקומי לקליפים שירדו מהענן, לתצוגות מקדימות, להעלאות ולקבצי הפלט.
            {desktopStatus?.storage?.localCache.isDefault
              ? ' כרגע נעשה שימוש במטמון ברירת המחדל של האפליקציה.'
              : ' נבחרה תיקייה ידנית.'}
          </p>
        ) : (
          <p className="settings-hint">בגרסת פיתוח התיקייה הזו היא סביבת העבודה המקומית הראשית.</p>
        )}
        <label className="settings-field">
          <span>{appInfo?.packaged ? 'תיקיית מטמון' : 'Workspace'}</span>
          <input
            value={workspaceDir}
            onChange={(e) => onWorkspaceDirChange(e.target.value)}
            placeholder={
              appInfo?.packaged && desktopStatus?.storage?.localCache.isDefault
                ? `ברירת מחדל · ${shortPath(desktopStatus?.storage?.localCache.workspaceDir)}`
                : ''
            }
          />
        </label>
        {appInfo?.packaged && !desktopStatus?.storage?.localCache.isDefault && (
          <div className="settings-actions-row">
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void onResetWorkspaceToDefault()}
              disabled={saving}
            >
              חזור למטמון ברירת המחדל
            </button>
          </div>
        )}
        <div className="settings-field-grid">
          <label className="settings-field">
            <span>FFmpeg</span>
            <input
              value={ffmpegPath}
              onChange={(e) => onFfmpegPathChange(e.target.value)}
              placeholder="PATH או נתיב מלא"
            />
          </label>
          <label className="settings-field">
            <span>FFprobe</span>
            <input
              value={ffprobePath}
              onChange={(e) => onFfprobePathChange(e.target.value)}
              placeholder="PATH או נתיב מלא"
            />
          </label>
        </div>
        <p className="settings-hint">
          ניקוי מטמון מוחק מהדיסק פוסטרים, תצוגות מקדימות, תמונות מקטעים וקבצי רינדור זמניים. הקטלוג וקבצי הווידאו המלאים לא נמחקים.
          הדפדפן עשוי להמשיך להציג תמונות ישנות עד רענון מלא (עד כשעה).
        </p>
        <div className="settings-actions-row">
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => void onClearDerivedCache()}
            disabled={saving || desktopLoading || clearCacheBusy}
          >
            {clearCacheBusy ? 'מנקה…' : 'נקה מטמון'}
          </button>
        </div>
        {desktopStatus && desktopStatus.workspace.missing.length > 0 && (
          <p className="settings-hint">
            חסרים בתיקייה: {desktopStatus.workspace.missing.join(', ')}
          </p>
        )}
      </section>

      {appInfo?.packaged ? (
        <section className="settings-section">
          <div className="settings-section-header">
            <h3>הסרת אפליקציה</h3>
          </div>
          <p className="settings-hint">
            <strong>הסרה רגילה:</strong> מסירה את האפליקציה אך משאירה נתונים מקומיים (מפתחות API, הגדרות, סשנים, יומנים).
            כך תוכל להתקין מחדש בלי לאבד הגדרות.
          </p>
          <p className="settings-hint">
            <strong>הסרה וניקוי מלא:</strong> מסירה את האפליקציה <em>וגם</em> מוחקת את כל הנתונים המקומיים — מצב פתיחה ראשונית.
            תיקיית הסביבה (workspace) לא נמחקת בשני המקרים.
          </p>
          <div className="settings-actions-row">
            <button
              type="button"
              className="btn btn--secondary"
              onClick={() => void onBeginUninstall()}
              disabled={saving || desktopLoading || uninstallBusy}
            >
              {uninstallBusy ? 'מעבד…' : 'הסר את WeatherV1'}
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => void onBeginUninstallWithCleanup()}
              disabled={saving || desktopLoading || uninstallBusy}
            >
              {uninstallBusy ? 'מעבד…' : 'הסר וניקוי מלא'}
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
