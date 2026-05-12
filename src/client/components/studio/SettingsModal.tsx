"use client";
import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/client/lib/desktop";
import type { DesktopAppInfo, DesktopSettingsUpdate, DesktopUpdateState } from "@/shared/desktop";

interface CatalogHealth {
  loaded_count?: number;
  claimed_count?: number;
  missing_ids?: string[];
  version?: string;
}

interface DesktopStatus {
  success: boolean;
  desktop_mode: boolean;
  workspace: {
    workspaceDir: string;
    catalogPath: string;
    videosDir: string;
    musicDir: string;
    missing: string[];
    ready: boolean;
  };
  runtime: {
    runtime_dir: string;
    uploads_dir: string;
    outputs_dir: string;
    cache_dir: string;
  };
  keys: {
    openai_configured: boolean;
    gemini_configured: boolean;
  };
  ffmpeg: {
    ffmpeg_path: string | null;
    ffprobe_path: string | null;
    bg_music_path: string;
  };
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

function StatusDot({ ok }: { ok: boolean }) {
  return <span className={`dot ${ok ? "is-healthy" : "is-missing"}`} />;
}

function shortPath(value: string | null | undefined): string {
  if (!value) return "לא הוגדר";
  if (value.length <= 64) return value;
  return `…${value.slice(-61)}`;
}

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [health, setHealth] = useState<CatalogHealth | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [desktopStatus, setDesktopStatus] = useState<DesktopStatus | null>(null);
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [updateState, setUpdateState] = useState<DesktopUpdateState | null>(null);
  const [desktopError, setDesktopError] = useState<string | null>(null);
  const [desktopLoading, setDesktopLoading] = useState(false);
  const [workspaceDir, setWorkspaceDir] = useState("");
  const [ffmpegPath, setFfmpegPath] = useState("");
  const [ffprobePath, setFfprobePath] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadHealth = useCallback(async () => {
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
  }, []);

  const loadDesktopStatus = useCallback(async () => {
    if (!desktop) return;
    setDesktopLoading(true);
    setDesktopError(null);
    try {
      const [nextAppInfo, nextUpdateState, statusResponse] = await Promise.all([
        desktop.getAppInfo(),
        desktop.getUpdateState(),
        fetch("/api/desktop/status"),
      ]);
      const status = await statusResponse.json() as DesktopStatus;
      if (!statusResponse.ok || !status.success) {
        throw new Error(`HTTP ${statusResponse.status}`);
      }
      setAppInfo(nextAppInfo);
      setUpdateState(nextUpdateState);
      setDesktopStatus(status);
      setWorkspaceDir(status.workspace.workspaceDir);
      setFfmpegPath(status.ffmpeg.ffmpeg_path ?? "");
      setFfprobePath(status.ffmpeg.ffprobe_path ?? "");
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setDesktopLoading(false);
    }
  }, []);

  const pickWorkspace = useCallback(async () => {
    if (!desktop) return;
    const picked = await desktop.pickWorkspace();
    if (picked) {
      setWorkspaceDir(picked.path);
      setSaved(false);
    }
  }, []);

  const saveDesktopSettings = useCallback(async () => {
    if (!desktop) return;
    setSaving(true);
    setSaved(false);
    setDesktopError(null);
    try {
      const update: DesktopSettingsUpdate = {};
      if (workspaceDir.trim()) update.workspaceDir = workspaceDir.trim();
      if (ffmpegPath.trim()) update.ffmpegPath = ffmpegPath.trim();
      if (ffprobePath.trim()) update.ffprobePath = ffprobePath.trim();
      if (openaiKey.trim()) update.openaiKey = openaiKey.trim();
      if (geminiKey.trim()) update.geminiKey = geminiKey.trim();

      await desktop.saveSettings(update);
      setOpenaiKey("");
      setGeminiKey("");
      await loadDesktopStatus();
      await loadHealth();
      setSaved(true);
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [ffmpegPath, ffprobePath, geminiKey, loadDesktopStatus, loadHealth, openaiKey, workspaceDir]);

  useEffect(() => {
    if (!isOpen) return;
    void loadHealth();
    void loadDesktopStatus();
  }, [isOpen, loadDesktopStatus, loadHealth]);

  if (!isOpen) return null;

  const loaded = health?.loaded_count ?? 0;
  const claimed = health?.claimed_count ?? 0;
  const missing = health?.missing_ids ?? [];
  const ver = health?.version ? health.version.slice(0, 8) : "?";
  const healthy = missing.length === 0;
  const isDesktop = Boolean(desktop);
  const workspaceReady = desktopStatus?.workspace.ready ?? false;
  const ffmpegReady = appInfo?.ffmpeg.ok ?? false;

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog modal-dialog--settings">
        {saving && (
          <div className="settings-reloading" role="status">
            שומר ומרענן את השרת המקומי…
          </div>
        )}
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
                    <StatusDot ok={healthy} />
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

          <section className="settings-section">
            <div className="settings-section-header">
              <h3>אפליקציית דסקטופ</h3>
              {saved && <span className="settings-saved-pill">נשמר</span>}
              {isDesktop && (
                <button
                  type="button"
                  className="settings-link"
                  onClick={loadDesktopStatus}
                  disabled={desktopLoading || saving}
                >
                  רענן
                </button>
              )}
            </div>
            {!isDesktop && (
              <div className="catalog-card">
                <span className="dot is-missing" />
                <span>מצב דסקטופ לא פעיל בחלון הנוכחי.</span>
              </div>
            )}
            {isDesktop && desktopError && (
              <div className="catalog-card">
                <span className="dot is-missing" />
                <span>שגיאה בטעינת מצב הדסקטופ: {desktopError}</span>
              </div>
            )}
            {isDesktop && !desktopError && (
              <div className="settings-status-grid">
                <div className="settings-status-row">
                  <StatusDot ok={workspaceReady} />
                  <span>סביבת עבודה</span>
                  <code title={desktopStatus?.workspace.workspaceDir}>{shortPath(desktopStatus?.workspace.workspaceDir)}</code>
                </div>
                <div className="settings-status-row">
                  <StatusDot ok={ffmpegReady} />
                  <span>FFmpeg</span>
                  <code title={appInfo?.ffmpeg.ffmpegPath ?? undefined}>{shortPath(appInfo?.ffmpeg.ffmpegPath)}</code>
                </div>
                <div className="settings-status-row">
                  <StatusDot ok={Boolean(desktopStatus?.keys.openai_configured)} />
                  <span>OpenAI</span>
                  <span>{desktopStatus?.keys.openai_configured ? "מוגדר" : "לא מוגדר"}</span>
                </div>
                <div className="settings-status-row">
                  <StatusDot ok={Boolean(desktopStatus?.keys.gemini_configured)} />
                  <span>Gemini</span>
                  <span>{desktopStatus?.keys.gemini_configured ? "מוגדר" : "לא מוגדר"}</span>
                </div>
                <div className="settings-status-row">
                  <span className="dot is-healthy" />
                  <span>גרסה</span>
                  <span>{appInfo ? `${appInfo.appVersion} · Electron ${appInfo.electronVersion}` : "טוען..."}</span>
                </div>
                <div className="settings-status-row">
                  <span className="dot is-healthy" />
                  <span>עדכונים</span>
                  <span>{updateState ? updateState.status : "טוען..."}</span>
                </div>
              </div>
            )}
          </section>

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>נתיבי דסקטופ</h3>
                <button type="button" className="settings-link" onClick={pickWorkspace} disabled={saving}>
                  בחר תיקייה
                </button>
              </div>
              <label className="settings-field">
                <span>Workspace</span>
                <input value={workspaceDir} onChange={(e) => { setWorkspaceDir(e.target.value); setSaved(false); }} />
              </label>
              <label className="settings-field">
                <span>FFmpeg</span>
                <input value={ffmpegPath} onChange={(e) => { setFfmpegPath(e.target.value); setSaved(false); }} placeholder="PATH או נתיב מלא" />
              </label>
              <label className="settings-field">
                <span>FFprobe</span>
                <input value={ffprobePath} onChange={(e) => { setFfprobePath(e.target.value); setSaved(false); }} placeholder="PATH או נתיב מלא" />
              </label>
              {desktopStatus && desktopStatus.workspace.missing.length > 0 && (
                <p className="settings-hint">
                  חסרים ב-workspace: {desktopStatus.workspace.missing.join(", ")}
                </p>
              )}
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>מפתחות API</h3>
              </div>
              <label className="settings-field">
                <span>OPENAI_API_KEY</span>
                <input type="password" value={openaiKey} onChange={(e) => { setOpenaiKey(e.target.value); setSaved(false); }} placeholder={desktopStatus?.keys.openai_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"} />
              </label>
              <label className="settings-field">
                <span>GEMINI_API_KEY</span>
                <input type="password" value={geminiKey} onChange={(e) => { setGeminiKey(e.target.value); setSaved(false); }} placeholder={desktopStatus?.keys.gemini_configured ? "מוגדר — הקלד כדי להחליף" : "אופציונלי"} />
              </label>
            </section>
          )}
        </div>
        <footer className="modal-footer">
          {isDesktop && (
            <button className="btn" type="button" onClick={saveDesktopSettings} disabled={saving || desktopLoading}>
              {saving ? "שומר…" : "שמור דסקטופ"}
            </button>
          )}
          <button className="btn btn--ghost" type="button" onClick={onClose}>סגור</button>
        </footer>
      </div>
    </div>
  );
}
