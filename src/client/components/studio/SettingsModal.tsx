"use client";
import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/client/lib/desktop";
import type {
  DesktopAppInfo,
  DesktopSettingsUpdate,
  DesktopUpdateState,
  LlmProviderPreference,
} from "@/shared/desktop";

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
    anthropic_configured: boolean;
    gemini_configured: boolean;
  };
  providers?: {
    llm_pref: LlmProviderPreference;
  };
  ffmpeg: {
    ffmpeg_path: string | null;
    ffprobe_path: string | null;
    bg_music_path: string;
  };
  catalog_store?: {
    kind: "local";
    enabled: boolean;
    ready: boolean;
  };
  r2?: {
    enabled: boolean;
    ready: boolean;
    gatewayUrl?: string;
    tenantId?: string;
    bucketName?: string;
    lastCatalogEtag?: string;
    lastSyncAt?: string;
    conflict?: { remoteEtag: string; localHash: string; detectedAt: string };
    counts: { local: number; cloudOnly: number; syncing: number; error: number };
    error?: string;
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
  const [anthropicKey, setAnthropicKey] = useState("");
  const [geminiKey, setGeminiKey] = useState("");
  const [r2Enabled, setR2Enabled] = useState(false);
  const [r2GatewayUrl, setR2GatewayUrl] = useState("");
  const [r2TenantId, setR2TenantId] = useState("");
  const [r2BucketName, setR2BucketName] = useState("");
  const [r2SessionToken, setR2SessionToken] = useState("");
  const [llmProvider, setLlmProvider] = useState<LlmProviderPreference>("auto");
  const [saving, setSaving] = useState(false);
  const [syncingR2, setSyncingR2] = useState(false);
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
      if (status.providers) {
        setLlmProvider(status.providers.llm_pref);
      }
      setR2Enabled(Boolean(status.r2?.enabled));
      setR2GatewayUrl(status.r2?.gatewayUrl ?? "");
      setR2TenantId(status.r2?.tenantId ?? "");
      setR2BucketName(status.r2?.bucketName ?? "");
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
      if (anthropicKey.trim()) update.anthropicKey = anthropicKey.trim();
      if (geminiKey.trim()) update.geminiKey = geminiKey.trim();
      update.r2Enabled = r2Enabled;
      update.r2GatewayUrl = r2GatewayUrl.trim();
      update.r2TenantId = r2TenantId.trim();
      update.r2BucketName = r2BucketName.trim();
      if (r2SessionToken.trim()) update.r2SessionToken = r2SessionToken.trim();
      update.llmProvider = llmProvider;

      await desktop.saveSettings(update);
      setOpenaiKey("");
      setAnthropicKey("");
      setGeminiKey("");
      setR2SessionToken("");
      await loadDesktopStatus();
      await loadHealth();
      setSaved(true);
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [
    anthropicKey,
    ffmpegPath,
    ffprobePath,
    geminiKey,
    llmProvider,
    loadDesktopStatus,
    loadHealth,
    openaiKey,
    r2BucketName,
    r2Enabled,
    r2GatewayUrl,
    r2SessionToken,
    r2TenantId,
    workspaceDir,
  ]);

  const clearKey = useCallback(async (provider: "openai" | "anthropic" | "gemini" | "r2") => {
    if (!desktop) return;
    setSaving(true);
    setDesktopError(null);
    try {
      await desktop.saveSettings({ clearKeys: [provider] });
      if (provider === "openai") setOpenaiKey("");
      if (provider === "anthropic") setAnthropicKey("");
      if (provider === "gemini") setGeminiKey("");
      if (provider === "r2") setR2SessionToken("");
      await loadDesktopStatus();
      await loadHealth();
      setSaved(true);
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [loadDesktopStatus, loadHealth]);

  const pullCatalogFromR2 = useCallback(async () => {
    setSyncingR2(true);
    setDesktopError(null);
    try {
      const r = await fetch("/api/sync/r2/pull", { method: "POST" });
      const data = (await r.json()) as { success: boolean; error?: string };
      if (!r.ok || !data.success) throw new Error(data.error ?? `HTTP ${r.status}`);
      await loadDesktopStatus();
      await loadHealth();
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingR2(false);
    }
  }, [loadDesktopStatus, loadHealth]);

  const pushCatalogToR2 = useCallback(async (replaceRemote = false) => {
    setSyncingR2(true);
    setDesktopError(null);
    try {
      const r = await fetch(replaceRemote ? "/api/sync/r2/replace-remote" : "/api/sync/r2/push", { method: "POST" });
      const data = (await r.json()) as { success: boolean; error?: string };
      if (!r.ok || !data.success) throw new Error(data.error ?? `HTTP ${r.status}`);
      await loadDesktopStatus();
      await loadHealth();
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingR2(false);
    }
  }, [loadDesktopStatus, loadHealth]);

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
                  <StatusDot ok={Boolean(desktopStatus?.keys.anthropic_configured)} />
                  <span>Anthropic</span>
                  <span>{desktopStatus?.keys.anthropic_configured ? "מוגדר" : "לא מוגדר"}</span>
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
                <div className="settings-status-row">
                  <StatusDot ok={Boolean(desktopStatus?.r2?.ready)} />
                  <span>Cloudflare R2</span>
                  <span>
                    {desktopStatus?.r2?.ready
                      ? `מחובר · ${desktopStatus.r2.lastSyncAt ? "סונכרן" : "ממתין לסנכרון"}`
                      : desktopStatus?.r2?.enabled ? "חסר קונפיגורציה" : "לא פעיל"}
                  </span>
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
                <h3>Cloudflare R2 Sync</h3>
                <button
                  type="button"
                  className="settings-link"
                  onClick={() => void pullCatalogFromR2()}
                  disabled={syncingR2 || !desktopStatus?.r2?.ready}
                >
                  {syncingR2 ? "מסנכרן…" : "משוך קטלוג"}
                </button>
              </div>
              <p className="settings-hint">
                R2 משמש כשכבת סנכרון וגיבוי. רינדור, תצוגות מקדימות וקבצי עבודה נשארים מקומיים.
                {appInfo?.packaged
                  ? " בגרסת ההפצה החיבור ל-R2 קבוע; אם חסר App Token הוא יופיע ככרטיס מעל הסטודיו."
                  : ""}
              </p>
              {!appInfo?.packaged && (
                <>
                  <label className="settings-field">
                    <span>Gateway URL</span>
                    <input
                      value={r2GatewayUrl}
                      onChange={(e) => {
                        setR2GatewayUrl(e.target.value);
                        setSaved(false);
                      }}
                      placeholder="https://weatherv1-r2-gateway.example.workers.dev"
                    />
                  </label>
                  <label className="settings-field">
                    <span>Tenant ID</span>
                    <input
                      value={r2TenantId}
                      onChange={(e) => {
                        setR2TenantId(e.target.value);
                        setSaved(false);
                      }}
                      placeholder="default"
                    />
                  </label>
                  <label className="settings-field">
                    <span>Bucket</span>
                    <input
                      value={r2BucketName}
                      onChange={(e) => {
                        setR2BucketName(e.target.value);
                        setSaved(false);
                      }}
                      placeholder="weatherv1-media"
                    />
                  </label>
                  <label className="settings-field">
                    <span>App Token</span>
                    <div style={{ display: "flex", gap: "8px", flex: 1 }}>
                  <input
                    type="password"
                    style={{ flex: 1 }}
                    value={r2SessionToken}
                    onChange={(e) => {
                      setR2SessionToken(e.target.value);
                      setSaved(false);
                    }}
                    placeholder={desktopStatus?.r2?.ready ? "מוגדר — הקלד כדי להחליף" : "Worker app token"}
                  />
                  {desktopStatus?.r2?.ready && (
                    <button type="button" className="btn btn--ghost" onClick={() => clearKey("r2")} disabled={saving}>
                      נקה
                    </button>
                  )}
                    </div>
                  </label>
                  <label className="settings-radio">
                    <input
                      type="checkbox"
                      checked={r2Enabled}
                      onChange={(e) => {
                        setR2Enabled(e.target.checked);
                        setSaved(false);
                      }}
                    />
                    <span>הפעל סנכרון ל-R2</span>
                  </label>
                </>
              )}
              <div className="settings-model-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void pushCatalogToR2(false)}
                  disabled={syncingR2 || saving || !desktopStatus?.r2?.ready}
                >
                  דחוף קטלוג
                </button>
                {desktopStatus?.r2?.conflict && (
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void pushCatalogToR2(true)}
                    disabled={syncingR2 || saving || !desktopStatus?.r2?.ready}
                  >
                    החלף מרוחק
                  </button>
                )}
              </div>
              {desktopStatus?.r2 && (
                <p className="settings-hint">
                  מקומי: {desktopStatus.r2.counts.local} · בענן בלבד: {desktopStatus.r2.counts.cloudOnly} · מסנכרן: {desktopStatus.r2.counts.syncing} · שגיאות: {desktopStatus.r2.counts.error}
                </p>
              )}
              {desktopStatus?.r2?.error && <p className="settings-hint">{desktopStatus.r2.error}</p>}
              {desktopStatus?.r2?.conflict && <p className="settings-hint">הקטלוג המרוחק השתנה. משוך מרחוק או החלף את המרוחק.</p>}
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>מפתחות API</h3>
              </div>
              <p className="settings-hint">
                הזן לפחות מפתח אחד מבין Anthropic או OpenAI לתכנון. תמלול האודיו רץ דרך OpenAI Whisper
                בענן, ולכן צריך OPENAI_API_KEY כדי לתמלל.
              </p>
              <label className="settings-field">
                <span>ANTHROPIC_API_KEY</span>
                <div style={{ display: "flex", gap: "8px", flex: 1 }}>
                  <input
                    type="password"
                    style={{ flex: 1 }}
                    value={anthropicKey}
                    onChange={(e) => {
                      setAnthropicKey(e.target.value);
                      setSaved(false);
                    }}
                    placeholder={
                      desktopStatus?.keys.anthropic_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"
                    }
                  />
                  {desktopStatus?.keys.anthropic_configured && (
                    <button type="button" className="btn btn--ghost" onClick={() => clearKey("anthropic")} disabled={saving}>
                      נקה
                    </button>
                  )}
                </div>
              </label>
              <label className="settings-field">
                <span>OPENAI_API_KEY</span>
                <div style={{ display: "flex", gap: "8px", flex: 1 }}>
                  <input
                    type="password"
                    style={{ flex: 1 }}
                    value={openaiKey}
                    onChange={(e) => {
                      setOpenaiKey(e.target.value);
                      setSaved(false);
                    }}
                    placeholder={
                      desktopStatus?.keys.openai_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"
                    }
                  />
                  {desktopStatus?.keys.openai_configured && (
                    <button type="button" className="btn btn--ghost" onClick={() => clearKey("openai")} disabled={saving}>
                      נקה
                    </button>
                  )}
                </div>
              </label>
              <label className="settings-field">
                <span>GEMINI_API_KEY</span>
                <div style={{ display: "flex", gap: "8px", flex: 1 }}>
                  <input
                    type="password"
                    style={{ flex: 1 }}
                    value={geminiKey}
                    onChange={(e) => {
                      setGeminiKey(e.target.value);
                      setSaved(false);
                    }}
                    placeholder={
                      desktopStatus?.keys.gemini_configured ? "מוגדר — הקלד כדי להחליף" : "אופציונלי"
                    }
                  />
                  {desktopStatus?.keys.gemini_configured && (
                    <button type="button" className="btn btn--ghost" onClick={() => clearKey("gemini")} disabled={saving}>
                      נקה
                    </button>
                  )}
                </div>
              </label>
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>בחירת ספק LLM</h3>
              </div>
              <fieldset className="settings-field">
                <legend>ספק LLM (תכנון סצנות וקליפים)</legend>
                {(
                  [
                    ["auto", "אוטומטי — לפי המפתחות הקיימים"],
                    ["anthropic", "Anthropic (Claude)"],
                    ["openai", "OpenAI (GPT-4o)"],
                  ] as Array<[LlmProviderPreference, string]>
                ).map(([id, label]) => (
                  <label key={id} className="settings-radio">
                    <input
                      type="radio"
                      name="llm-provider"
                      value={id}
                      checked={llmProvider === id}
                      onChange={() => {
                        setLlmProvider(id);
                        setSaved(false);
                      }}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="settings-hint">
                תמלול האודיו רץ דרך OpenAI Whisper בענן (אין מודל מקומי בגרסה הזו).
              </p>
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
