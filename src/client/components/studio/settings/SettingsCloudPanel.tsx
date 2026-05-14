"use client";

import type { DesktopAppInfo } from "@/shared/desktop";
import type { DesktopStatus } from "./settingsTypes";
import { StatusDot, shortPath } from "./settingsShared";

interface SettingsCloudPanelProps {
  appInfo: DesktopAppInfo | null;
  desktopStatus: DesktopStatus | null;
  saving: boolean;
  syncingR2: boolean;
  exportR2JobsLoading: boolean;
  r2Enabled: boolean;
  r2GatewayUrl: string;
  r2TenantId: string;
  r2BucketName: string;
  r2AppUsername: string;
  r2AppPassword: string;
  showR2Password: boolean;
  onR2GatewayUrlChange: (value: string) => void;
  onR2TenantIdChange: (value: string) => void;
  onR2BucketNameChange: (value: string) => void;
  onR2AppUsernameChange: (value: string) => void;
  onR2AppPasswordChange: (value: string) => void;
  onR2EnabledChange: (enabled: boolean) => void;
  onShowR2PasswordToggle: () => void;
  onClearR2Key: () => void;
  onPullCatalogFromR2: () => void;
  onPushCatalogToR2: (replaceRemote?: boolean) => void;
  onExportJobsFromR2: () => void;
}

export function SettingsCloudPanel({
  appInfo,
  desktopStatus,
  saving,
  syncingR2,
  exportR2JobsLoading,
  r2Enabled,
  r2GatewayUrl,
  r2TenantId,
  r2BucketName,
  r2AppUsername,
  r2AppPassword,
  showR2Password,
  onR2GatewayUrlChange,
  onR2TenantIdChange,
  onR2BucketNameChange,
  onR2AppUsernameChange,
  onR2AppPasswordChange,
  onR2EnabledChange,
  onShowR2PasswordToggle,
  onClearR2Key,
  onPullCatalogFromR2,
  onPushCatalogToR2,
  onExportJobsFromR2,
}: SettingsCloudPanelProps) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>{appInfo?.packaged ? "ספריית הענן (R2)" : "Cloudflare R2 Sync"}</h3>
        <button
          type="button"
          className="settings-link"
          onClick={() => void onPullCatalogFromR2()}
          disabled={syncingR2 || !desktopStatus?.r2?.ready}
        >
          {syncingR2 ? "מסנכרן…" : "משוך קטלוג"}
        </button>
      </div>
      {appInfo?.packaged ? (
        <>
          <p className="settings-hint">
            החיבור ל-R2 מוגדר מראש בגרסת ההפצה. אם חסרים פרטי הכניסה, מסך התחברות יופיע בעת הפעלת האפליקציה.
          </p>
          <div className="settings-status-grid">
            <div className="settings-status-row">
              <StatusDot variant={Boolean(desktopStatus?.r2?.ready) ? "ok" : "danger"} />
              <span>סטטוס</span>
              <span>
                {desktopStatus?.r2?.ready
                  ? "מחובר"
                  : desktopStatus?.r2?.enabled
                    ? "ממתין להתחברות"
                    : "לא פעיל"}
              </span>
            </div>
            {desktopStatus?.r2?.appUsername ? (
              <div className="settings-status-row">
                <span className="dot is-healthy" />
                <span>שם משתמש</span>
                <code>{desktopStatus.r2.appUsername}</code>
              </div>
            ) : null}
            {desktopStatus?.r2?.gatewayUrl ? (
              <div className="settings-status-row">
                <span className="dot is-healthy" />
                <span>Gateway</span>
                <code title={desktopStatus.r2.gatewayUrl}>
                  {shortPath(desktopStatus.r2.gatewayUrl)}
                </code>
              </div>
            ) : null}
            {desktopStatus?.r2?.bucketName ? (
              <div className="settings-status-row">
                <span className="dot is-healthy" />
                <span>Bucket</span>
                <code>{desktopStatus.r2.bucketName}</code>
              </div>
            ) : null}
            <div className="settings-status-row">
              <span className="dot is-healthy" />
              <span>סנכרון אחרון</span>
              <span>{desktopStatus?.r2?.lastSyncAt ?? "טרם בוצע"}</span>
            </div>
          </div>
          {desktopStatus?.r2?.ready ? (
            <div className="settings-actions-row">
              <button type="button" className="btn btn--ghost" onClick={onClearR2Key} disabled={saving}>
                התנתק (נקה סיסמה)
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="settings-hint">
            בפיתוח אפשר להגדיר Gateway, Tenant ו-Bucket באופן ידני. בגרסת ההפצה הם נעולים על החשבון של WeatherV1.
          </p>
          <label className="settings-field">
            <span>Gateway URL</span>
            <input
              value={r2GatewayUrl}
              onChange={(e) => onR2GatewayUrlChange(e.target.value)}
              placeholder="https://weatherv1-r2-gateway.example.workers.dev"
            />
          </label>
          <label className="settings-field">
            <span>Tenant ID</span>
            <input
              value={r2TenantId}
              onChange={(e) => onR2TenantIdChange(e.target.value)}
              placeholder="default"
            />
          </label>
          <label className="settings-field">
            <span>Bucket</span>
            <input
              value={r2BucketName}
              onChange={(e) => onR2BucketNameChange(e.target.value)}
              placeholder="weatherv1-media"
            />
          </label>
          <label className="settings-field">
            <span>שם משתמש</span>
            <input
              value={r2AppUsername}
              onChange={(e) => onR2AppUsernameChange(e.target.value)}
              placeholder="weatherv1"
              autoComplete="username"
              spellCheck={false}
            />
          </label>
          <label className="settings-field">
            <span>סיסמה</span>
            <div className="settings-password">
              <input
                type={showR2Password ? "text" : "password"}
                className="settings-password__input"
                value={r2AppPassword}
                onChange={(e) => onR2AppPasswordChange(e.target.value)}
                placeholder={
                  desktopStatus?.r2?.ready ? "מוגדר — הקלד כדי להחליף" : "סיסמה לעובד R2"
                }
                autoComplete="current-password"
              />
              <button
                type="button"
                className="settings-password__toggle"
                onClick={onShowR2PasswordToggle}
                aria-pressed={showR2Password}
                aria-label={showR2Password ? "הסתר סיסמה" : "הצג סיסמה"}
                tabIndex={-1}
              >
                {showR2Password ? "הסתר" : "הצג"}
              </button>
              {desktopStatus?.r2?.ready ? (
                <button type="button" className="btn btn--ghost" onClick={onClearR2Key} disabled={saving}>
                  נקה
                </button>
              ) : null}
            </div>
          </label>
          <label className="settings-radio">
            <input
              type="checkbox"
              checked={r2Enabled}
              onChange={(e) => onR2EnabledChange(e.target.checked)}
            />
            <span>הפעל סנכרון ל-R2</span>
          </label>
        </>
      )}
      {desktopStatus?.r2?.enabled ? (
        <p className="settings-hint">
          כפתור Export JSON מוריד את snapshot של המשימות מתוך R2 (<code dir="ltr">jobs/jobs.json</code>) —
          מה שהשרת משחזר לענן.
        </p>
      ) : null}
      <div className="settings-actions-row">
        {desktopStatus?.r2?.enabled ? (
          <button
            type="button"
            className="btn btn--secondary"
            id="export-jobs-json-r2"
            onClick={() => void onExportJobsFromR2()}
            disabled={exportR2JobsLoading || syncingR2 || saving || !desktopStatus?.r2?.ready}
            title={
              desktopStatus?.r2?.ready ? "ייצוא jobs.json מ-R2" : "נדרש חיבור תקף ל-R2"
            }
          >
            {exportR2JobsLoading ? "טוען…" : "Export JSON"}
          </button>
        ) : null}
        <button
          type="button"
          className="btn btn--ghost"
          onClick={() => void onPushCatalogToR2(false)}
          disabled={syncingR2 || saving || !desktopStatus?.r2?.ready}
        >
          דחוף קטלוג
        </button>
        {desktopStatus?.r2?.conflict ? (
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void onPushCatalogToR2(true)}
            disabled={syncingR2 || saving || !desktopStatus?.r2?.ready}
          >
            החלף מרוחק
          </button>
        ) : null}
      </div>
      {desktopStatus?.r2 ? (
        <p className="settings-hint">
          מקומי: {desktopStatus.r2.counts.local} · בענן בלבד: {desktopStatus.r2.counts.cloudOnly} · מסנכרן:{" "}
          {desktopStatus.r2.counts.syncing} · שגיאות: {desktopStatus.r2.counts.error}
        </p>
      ) : null}
      {desktopStatus?.r2?.error ? <p className="settings-hint">{desktopStatus.r2.error}</p> : null}
      {desktopStatus?.r2?.conflict ? (
        <p className="settings-hint">הקטלוג המרוחק השתנה. משוך מרחוק או החלף את המרוחק.</p>
      ) : null}
    </section>
  );
}
