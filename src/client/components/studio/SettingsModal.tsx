"use client";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { downloadJsonFile } from "@/client/lib/download-json-file";
import { desktop } from "@/client/lib/desktop";
import type {
  DesktopAppInfo,
  DesktopSettingsUpdate,
  DesktopUpdateState,
  LlmProviderPreference,
} from "@/shared/desktop";
import type { StorageStatus } from "@/client/hooks/useStorageStatus";

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
    appUsername?: string;
    lastCatalogEtag?: string;
    lastSyncAt?: string;
    conflict?: { remoteEtag: string; localHash: string; detectedAt: string };
    counts: { local: number; cloudOnly: number; syncing: number; error: number };
    error?: string;
  };
  storage?: StorageStatus;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type DotVariant = "ok" | "warn" | "danger";

function StatusDot({ variant }: { variant: DotVariant }) {
  const cls =
    variant === "ok" ? "is-healthy" : variant === "warn" ? "is-warn" : "is-missing";
  return <span className={`dot ${cls}`} />;
}

interface SettingsStatCardProps {
  label: string;
  value: ReactNode;
  dotVariant: DotVariant;
  hint?: string;
}

function SettingsStatCard({ label, value, dotVariant, hint }: SettingsStatCardProps) {
  return (
    <div className="settings-stat-card">
      <div className="settings-stat-card-top">
        <StatusDot variant={dotVariant} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

interface SecretFieldProps {
  label: string;
  value: string;
  configured: boolean;
  placeholder: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  onClear: () => void;
}

function SecretField({
  label,
  value,
  configured,
  placeholder,
  disabled,
  onValueChange,
  onClear,
}: SecretFieldProps) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <div className="settings-input-group">
        <input
          type="password"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {configured && (
          <button type="button" className="btn btn--ghost" onClick={onClear} disabled={disabled}>
            נקה
          </button>
        )}
      </div>
    </label>
  );
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
  const [r2AppUsername, setR2AppUsername] = useState("");
  const [r2AppPassword, setR2AppPassword] = useState("");
  const [showR2Password, setShowR2Password] = useState(false);
  const [llmProvider, setLlmProvider] = useState<LlmProviderPreference>("auto");
  const [saving, setSaving] = useState(false);
  const [syncingR2, setSyncingR2] = useState(false);
  const [exportR2JobsLoading, setExportR2JobsLoading] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
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
      setR2AppUsername(status.r2?.appUsername ?? "");
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

  const resetWorkspaceToDefault = useCallback(async () => {
    if (!desktop) return;
    setSaving(true);
    setDesktopError(null);
    try {
      // Empty workspaceDir tells Electron to fall back to the app-managed
      // default local cache under userData (packaged builds only).
      await desktop.saveSettings({ workspaceDir: "" });
      setWorkspaceDir("");
      await loadDesktopStatus();
      await loadHealth();
      setSaved(true);
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [loadDesktopStatus, loadHealth]);

  const beginUninstall = useCallback(async () => {
    if (!desktop) return;
    setUninstallBusy(true);
    setDesktopError(null);
    try {
      const r = await desktop.beginUninstall();
      if (!r.ok && r.reason && r.reason !== "בוטל") {
        setDesktopError(r.reason);
      }
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setUninstallBusy(false);
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
      update.r2AppUsername = r2AppUsername.trim();
      if (r2AppPassword) update.r2AppPassword = r2AppPassword;
      update.llmProvider = llmProvider;

      await desktop.saveSettings(update);
      setOpenaiKey("");
      setAnthropicKey("");
      setGeminiKey("");
      setR2AppPassword("");
      setShowR2Password(false);
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
    r2AppPassword,
    r2AppUsername,
    r2BucketName,
    r2Enabled,
    r2GatewayUrl,
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
      if (provider === "r2") {
        setR2AppPassword("");
        setShowR2Password(false);
      }
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

  const exportJobsFromR2 = useCallback(async () => {
    setExportR2JobsLoading(true);
    setDesktopError(null);
    try {
      const res = await fetch("/api/jobs/export-r2");
      let data: {
        success?: boolean;
        error?: string;
        detail?: string;
        jobs?: Record<string, unknown>;
        objectKey?: string;
        etag?: string;
        updatedAt?: string;
        exportedAt?: string;
      };
      try {
        data = (await res.json()) as typeof data;
      } catch {
        throw new Error(`בעיית תשובה מהשרת · HTTP ${res.status}`);
      }
      if (!res.ok || !data.success || data.jobs === undefined) {
        const msg = data.error ?? `HTTP ${res.status}`;
        const detail = data.detail ? ` ${data.detail}` : "";
        throw new Error(`${msg}${detail}`);
      }
      const now = new Date();
      const stamp = now.toISOString().replace(/[:]/g, "-").slice(0, 19);
      downloadJsonFile(`weatherv1-jobs-r2-${stamp}.json`, {
        exportedAt: data.exportedAt ?? now.toISOString(),
        source: "weatherv1-r2-jobs-snapshot",
        objectKey: data.objectKey,
        etag: data.etag,
        updatedAt: data.updatedAt,
        jobs: data.jobs,
      });
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setExportR2JobsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    void loadHealth();
    void loadDesktopStatus();
  }, [isOpen, loadDesktopStatus, loadHealth]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const claimed = health?.claimed_count ?? 0;
  const missing = health?.missing_ids ?? [];
  const ver = health?.version ? health.version.slice(0, 8) : "?";
  const onDiskCount = Math.max(0, claimed - missing.length);
  const isDesktop = Boolean(desktop);
  const workspaceReady = desktopStatus?.workspace.ready ?? false;
  const ffmpegReady = appInfo?.ffmpeg.ok ?? false;
  const catalogKnown = Boolean(health);
  const configuredKeysCount = [
    desktopStatus?.keys.anthropic_configured,
    desktopStatus?.keys.openai_configured,
    desktopStatus?.keys.gemini_configured,
  ].filter(Boolean).length;
  const r2Ready = Boolean(desktopStatus?.r2?.ready);
  const r2EnabledFlag = Boolean(desktopStatus?.r2?.enabled);
  const r2ErrorCount = desktopStatus?.r2?.counts.error ?? 0;
  const catalogHealthBlocked =
    Boolean(healthError) || (r2EnabledFlag && r2ErrorCount > 0);
  let catalogDotVariant: DotVariant = "ok";
  if (catalogHealthBlocked) {
    catalogDotVariant = "danger";
  } else if (missing.length === 0) {
    catalogDotVariant = "ok";
  } else if (r2Ready) {
    catalogDotVariant = "warn";
  } else {
    catalogDotVariant = "danger";
  }
  const catalogStatHint = (() => {
    if (healthError) return "שגיאה בטעינה";
    if (r2EnabledFlag && r2ErrorCount > 0) return `${r2ErrorCount} שגיאות סנכרון בענן`;
    if (!catalogKnown) return "בודק קטלוג";
    if (missing.length === 0) return "הקטלוג מוכן לעבודה";
    if (r2Ready) return `מטמון מקומי חלקי — הרנדר מוריד מקטעים מ-R2 לפי הצורך`;
    return `${missing.length} קבצי מקור חסרים במטמון המקומי`;
  })();

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" aria-describedby="settings-description">
      <div className="modal-backdrop" onClick={onClose} />
      <div className="modal-dialog modal-dialog--settings" aria-busy={saving || desktopLoading || exportR2JobsLoading}>
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
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (isDesktop && !saving && !desktopLoading) void saveDesktopSettings();
          }}
        >
        <div className="modal-body">
          <section className="settings-overview" aria-label="תקציר הגדרות">
            <div>
              <p className="settings-eyebrow">WeatherV1 Control Center</p>
              <p className="settings-intro" id="settings-description">
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
                  healthLoading || !catalogKnown
                    ? "warn"
                    : catalogDotVariant
                }
                hint={healthLoading || !catalogKnown ? "בודק קטלוג" : catalogStatHint}
              />
              <SettingsStatCard
                label="דסקטופ"
                value={desktopLoading ? "טוען…" : isDesktop ? (workspaceReady ? "מוכן" : "דורש בדיקה") : "לא פעיל"}
                dotVariant={isDesktop && workspaceReady ? "ok" : "danger"}
                hint={isDesktop ? shortPath(desktopStatus?.workspace.workspaceDir) : "פתח דרך Electron"}
              />
              <SettingsStatCard
                label="AI"
                value={<span dir="ltr">{configuredKeysCount}/3</span>}
                dotVariant={configuredKeysCount > 0 ? "ok" : "danger"}
                hint={configuredKeysCount > 0 ? "מפתח אחד לפחות מוגדר" : "צריך מפתח לתכנון"}
              />
              <SettingsStatCard
                label="R2"
                value={r2Ready ? "מחובר" : desktopStatus?.r2?.enabled ? "חסר פרטים" : "כבוי"}
                dotVariant={r2Ready ? "ok" : "danger"}
                hint={desktopStatus?.r2?.lastSyncAt ? `סונכרן ${desktopStatus.r2.lastSyncAt}` : "טרם סונכרן"}
              />
            </div>
          </section>

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
              <strong>שורות בקטלוג</strong> — כמה קליפים מוגדרים ב־{' '}
              <span dir="ltr" lang="en" className="settings-ltr-seg">
                catalog
              </span>
              {' '}
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
                          {missing.slice(0, 6).join(", ")}
                          {missing.length > 6 ? "…" : ""}
                        </span>
                      </summary>
                      <div className="catalog-missing-list-scroll" dir="ltr" lang="en">
                        {missing.join(", ")}
                      </div>
                    </details>
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
                <span>
                  שגיאה בטעינת מצב הדסקטופ:{' '}
                  <span dir="ltr" lang="en" className="settings-ltr-snippet">
                    {desktopError}
                  </span>
                </span>
              </div>
            )}
            {isDesktop && !desktopError && (
              <div className="settings-status-grid">
                <div className="settings-status-row">
                  <StatusDot variant={workspaceReady ? "ok" : "danger"} />
                  <span>סביבת עבודה</span>
                  <code title={desktopStatus?.workspace.workspaceDir}>{shortPath(desktopStatus?.workspace.workspaceDir)}</code>
                </div>
                <div className="settings-status-row">
                  <StatusDot variant={ffmpegReady ? "ok" : "danger"} />
                  <span>FFmpeg</span>
                  <code title={appInfo?.ffmpeg.ffmpegPath ?? undefined}>{shortPath(appInfo?.ffmpeg.ffmpegPath)}</code>
                </div>
                <div className="settings-status-row">
                  <StatusDot variant={Boolean(desktopStatus?.keys.anthropic_configured) ? "ok" : "danger"} />
                  <span>Anthropic</span>
                  <span>{desktopStatus?.keys.anthropic_configured ? "מוגדר" : "לא מוגדר"}</span>
                </div>
                <div className="settings-status-row">
                  <StatusDot variant={Boolean(desktopStatus?.keys.openai_configured) ? "ok" : "danger"} />
                  <span>OpenAI</span>
                  <span>{desktopStatus?.keys.openai_configured ? "מוגדר" : "לא מוגדר"}</span>
                </div>
                <div className="settings-status-row">
                  <StatusDot variant={Boolean(desktopStatus?.keys.gemini_configured) ? "ok" : "danger"} />
                  <span>Gemini</span>
                  <span>{desktopStatus?.keys.gemini_configured ? "מוגדר" : "לא מוגדר"}</span>
                </div>
                <div className="settings-status-row">
                  <span className="dot is-healthy" />
                  <span>גרסה</span>
                  <span>{appInfo ? `${appInfo.appVersion} · Electron ${appInfo.electronVersion}` : "טוען…"}</span>
                </div>
                <div className="settings-status-row">
                  <span className="dot is-healthy" />
                  <span>עדכונים</span>
                  <span>{updateState ? updateState.status : "טוען…"}</span>
                </div>
              </div>
            )}
          </section>

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>מפתחות API</h3>
              </div>
              <p className="settings-hint">
                הזן לפחות מפתח אחד מבין Anthropic או OpenAI לתכנון. תמלול האודיו רץ דרך OpenAI Whisper
                בענן, ולכן צריך OPENAI_API_KEY כדי לתמלל.
              </p>
              <SecretField
                label="ANTHROPIC_API_KEY"
                value={anthropicKey}
                configured={Boolean(desktopStatus?.keys.anthropic_configured)}
                placeholder={desktopStatus?.keys.anthropic_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"}
                disabled={saving}
                onValueChange={(value) => {
                  setAnthropicKey(value);
                  setSaved(false);
                }}
                onClear={() => void clearKey("anthropic")}
              />
              <SecretField
                label="OPENAI_API_KEY"
                value={openaiKey}
                configured={Boolean(desktopStatus?.keys.openai_configured)}
                placeholder={desktopStatus?.keys.openai_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"}
                disabled={saving}
                onValueChange={(value) => {
                  setOpenaiKey(value);
                  setSaved(false);
                }}
                onClear={() => void clearKey("openai")}
              />
              <SecretField
                label="GEMINI_API_KEY"
                value={geminiKey}
                configured={Boolean(desktopStatus?.keys.gemini_configured)}
                placeholder={desktopStatus?.keys.gemini_configured ? "מוגדר — הקלד כדי להחליף" : "אופציונלי"}
                disabled={saving}
                onValueChange={(value) => {
                  setGeminiKey(value);
                  setSaved(false);
                }}
                onClear={() => void clearKey("gemini")}
              />
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>{appInfo?.packaged ? "מטמון מקומי" : "סביבת עבודה ונתיבי FFmpeg"}</h3>
                <button type="button" className="settings-link" onClick={pickWorkspace} disabled={saving}>
                  בחר תיקייה
                </button>
              </div>
              {appInfo?.packaged ? (
                <p className="settings-hint">
                  R2 הוא מקור האמת לקטלוג. התיקייה הזו משמשת כמטמון מקומי לקליפים שירדו מהענן,
                  לתצוגות מקדימות, להעלאות ולקבצי הפלט.
                  {desktopStatus?.storage?.localCache.isDefault
                    ? " כרגע נעשה שימוש במטמון ברירת המחדל של האפליקציה."
                    : " נבחרה תיקייה ידנית."}
                </p>
              ) : (
                <p className="settings-hint">
                  בגרסת פיתוח התיקייה הזו היא סביבת העבודה המקומית הראשית.
                </p>
              )}
              <label className="settings-field">
                <span>{appInfo?.packaged ? "תיקיית מטמון" : "Workspace"}</span>
                <input
                  value={workspaceDir}
                  onChange={(e) => { setWorkspaceDir(e.target.value); setSaved(false); }}
                  placeholder={
                    appInfo?.packaged && desktopStatus?.storage?.localCache.isDefault
                      ? `ברירת מחדל · ${shortPath(desktopStatus?.storage?.localCache.workspaceDir)}`
                      : ""
                  }
                />
              </label>
              {appInfo?.packaged && !desktopStatus?.storage?.localCache.isDefault && (
                <div className="settings-actions-row">
                  <button
                    type="button"
                    className="btn btn--ghost"
                    onClick={() => void resetWorkspaceToDefault()}
                    disabled={saving}
                  >
                    חזור למטמון ברירת המחדל
                  </button>
                </div>
              )}
              <div className="settings-field-grid">
                <label className="settings-field">
                  <span>FFmpeg</span>
                  <input value={ffmpegPath} onChange={(e) => { setFfmpegPath(e.target.value); setSaved(false); }} placeholder="PATH או נתיב מלא" />
                </label>
                <label className="settings-field">
                  <span>FFprobe</span>
                  <input value={ffprobePath} onChange={(e) => { setFfprobePath(e.target.value); setSaved(false); }} placeholder="PATH או נתיב מלא" />
                </label>
              </div>
              {desktopStatus && desktopStatus.workspace.missing.length > 0 && (
                <p className="settings-hint">
                  חסרים בתיקייה: {desktopStatus.workspace.missing.join(", ")}
                </p>
              )}
            </section>
          )}

          {isDesktop && appInfo?.packaged && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>הסרת אפליקציה</h3>
              </div>
              <p className="settings-hint">
                ב-Windows יופעל מסיר ההתקנה של המערכת. ב-macOS ייפתח Finder ליד WeatherV1.app — סגור את האפליקציה
                וגרור את היישום לסל המחזור.
              </p>
              <div className="settings-actions-row">
                <button
                  type="button"
                  className="btn btn--danger"
                  onClick={() => void beginUninstall()}
                  disabled={saving || desktopLoading || uninstallBusy}
                >
                  {uninstallBusy ? "מעבד…" : "הסר את WeatherV1"}
                </button>
              </div>
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>{appInfo?.packaged ? "ספריית הענן (R2)" : "Cloudflare R2 Sync"}</h3>
                <button
                  type="button"
                  className="settings-link"
                  onClick={() => void pullCatalogFromR2()}
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
                    {desktopStatus?.r2?.appUsername && (
                      <div className="settings-status-row">
                        <span className="dot is-healthy" />
                        <span>שם משתמש</span>
                        <code>{desktopStatus.r2.appUsername}</code>
                      </div>
                    )}
                    {desktopStatus?.r2?.gatewayUrl && (
                      <div className="settings-status-row">
                        <span className="dot is-healthy" />
                        <span>Gateway</span>
                        <code title={desktopStatus.r2.gatewayUrl}>{shortPath(desktopStatus.r2.gatewayUrl)}</code>
                      </div>
                    )}
                    {desktopStatus?.r2?.bucketName && (
                      <div className="settings-status-row">
                        <span className="dot is-healthy" />
                        <span>Bucket</span>
                        <code>{desktopStatus.r2.bucketName}</code>
                      </div>
                    )}
                    <div className="settings-status-row">
                      <span className="dot is-healthy" />
                      <span>סנכרון אחרון</span>
                      <span>{desktopStatus?.r2?.lastSyncAt ?? "טרם בוצע"}</span>
                    </div>
                  </div>
                  {desktopStatus?.r2?.ready && (
                    <div className="settings-actions-row">
                      <button type="button" className="btn btn--ghost" onClick={() => clearKey("r2")} disabled={saving}>
                        התנתק (נקה סיסמה)
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <p className="settings-hint">
                    בפיתוח אפשר להגדיר Gateway, Tenant ו-Bucket באופן ידני. בגרסת ההפצה הם נעולים על
                    החשבון של WeatherV1.
                  </p>
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
                    <span>שם משתמש</span>
                    <input
                      value={r2AppUsername}
                      onChange={(e) => {
                        setR2AppUsername(e.target.value);
                        setSaved(false);
                      }}
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
                        onChange={(e) => {
                          setR2AppPassword(e.target.value);
                          setSaved(false);
                        }}
                        placeholder={desktopStatus?.r2?.ready ? "מוגדר — הקלד כדי להחליף" : "סיסמה לעובד R2"}
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        className="settings-password__toggle"
                        onClick={() => setShowR2Password((v) => !v)}
                        aria-pressed={showR2Password}
                        aria-label={showR2Password ? "הסתר סיסמה" : "הצג סיסמה"}
                        tabIndex={-1}
                      >
                        {showR2Password ? "הסתר" : "הצג"}
                      </button>
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
              {desktopStatus?.r2?.enabled ? (
                <p className="settings-hint">
                  כפתור Export JSON מוריד את snapshot של המשימות מתוך R2 (<code dir="ltr">jobs/jobs.json</code>) — מה שהשרת משחזר לענן.
                </p>
              ) : null}
              <div className="settings-actions-row">
                {desktopStatus?.r2?.enabled ? (
                  <button
                    type="button"
                    className="btn btn--secondary"
                    id="export-jobs-json-r2"
                    onClick={() => void exportJobsFromR2()}
                    disabled={exportR2JobsLoading || syncingR2 || saving || !desktopStatus?.r2?.ready}
                    title={
                      desktopStatus?.r2?.ready
                        ? "ייצוא jobs.json מ-R2"
                        : "נדרש חיבור תקף ל-R2"
                    }
                  >
                    {exportR2JobsLoading ? "טוען…" : "Export JSON"}
                  </button>
                ) : null}
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
                <h3 id="settings-llm-provider-title">בחירת ספק LLM</h3>
              </div>
              <fieldset
                className="settings-field"
                aria-labelledby="settings-llm-provider-title"
              >
                <legend className="sr-only">ספק LLM לתכנון סצנות וקליפים</legend>
                {(
                  [
                    ["auto", "אוטומטי — לפי המפתחות הקיימים"],
                    [
                      "anthropic",
                      <span dir="ltr">Anthropic (Claude)</span>,
                    ],
                    [
                      "openai",
                      <span dir="ltr">OpenAI (GPT-4o)</span>,
                    ],
                  ] as Array<[LlmProviderPreference, ReactNode]>
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
                    <span className="settings-radio-label">{label}</span>
                  </label>
                ))}
              </fieldset>
              <p className="settings-hint">
                תמלול האודיו (Whisper) דורש מפתח OpenAI לפי הסעיף &quot;מפתחות API&quot; למעלה.
              </p>
            </section>
          )}
        </div>
        <footer className="modal-footer">
          {isDesktop && (
            <button className="btn" type="submit" disabled={saving || desktopLoading}>
              {saving ? "שומר…" : "שמור דסקטופ"}
            </button>
          )}
          <button className="btn btn--ghost" type="button" onClick={onClose}>סגור</button>
        </footer>
        </form>
      </div>
    </div>
  );
}
