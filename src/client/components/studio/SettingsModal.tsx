"use client";

import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/client/lib/desktop";
import type {
  DesktopAppInfo,
  DesktopSettingsUpdate,
  DesktopUpdateState,
  LlmProviderPreference,
} from "@/shared/desktop";
import { downloadJsonFile } from "@/client/lib/download-json-file";

import type { CatalogHealth, DesktopStatus, DotVariant } from "./settings/settingsTypes";
import { SettingsAiPanel } from "./settings/SettingsAiPanel";
import { SettingsCatalogPanel } from "./settings/SettingsCatalogPanel";
import { SettingsCloudPanel } from "./settings/SettingsCloudPanel";
import { SettingsDesktopPanel } from "./settings/SettingsDesktopPanel";
import { SettingsOverviewPanel } from "./settings/SettingsOverviewPanel";

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsTabId = "overview" | "catalog" | "desktop" | "ai" | "cloud";

const SETTINGS_TABS_DESKTOP: { id: SettingsTabId; label: string }[] = [
  { id: "overview", label: "סקירה" },
  { id: "catalog", label: "קטלוג קליפים" },
  { id: "desktop", label: "דסקטופ וקבצים" },
  { id: "ai", label: "AI ומודלים" },
  { id: "cloud", label: "ענן (R2)" },
];

const SETTINGS_TABS_BROWSER: { id: SettingsTabId; label: string }[] = [
  { id: "overview", label: "סקירה" },
  { id: "catalog", label: "קטלוג קליפים" },
];

const EMPTY_KEYS: DesktopStatus["keys"] = {
  openai_configured: false,
  anthropic_configured: false,
  gemini_configured: false,
};

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeTab, setActiveTab] = useState<SettingsTabId>("overview");
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
  const [clearCacheBusy, setClearCacheBusy] = useState(false);
  const [uninstallBusy, setUninstallBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  const loadHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const r = await fetch("/api/catalog/health");
      const data = (await r.json()) as { success: boolean; health?: CatalogHealth; error?: string };
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
      const status = (await statusResponse.json()) as DesktopStatus;
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

  const clearKey = useCallback(
    async (provider: "openai" | "anthropic" | "gemini" | "r2") => {
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
    },
    [loadDesktopStatus, loadHealth],
  );

  const clearDerivedCache = useCallback(async () => {
    if (
      !window.confirm(
        "למחוק מהדיסק את הפוסטרים, התצוגות המקדימות, תמונות המקטעים וקבצי הרינדור הזמניים?\nהקטלוג וקבצי הווידאו המלאים לא יימחקו.",
      )
    ) {
      return;
    }
    setClearCacheBusy(true);
    setDesktopError(null);
    try {
      const r = await fetch("/api/runtime/clear-derived-cache", { method: "POST" });
      const data = (await r.json()) as { success: boolean; error?: string };
      if (!r.ok || !data.success) throw new Error(data.error ?? `HTTP ${r.status}`);
      await loadDesktopStatus();
      await loadHealth();
      setSaved(true);
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setClearCacheBusy(false);
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

  const pushCatalogToR2 = useCallback(
    async (replaceRemote = false) => {
      setSyncingR2(true);
      setDesktopError(null);
      try {
        const r = await fetch(replaceRemote ? "/api/sync/r2/replace-remote" : "/api/sync/r2/push", {
          method: "POST",
        });
        const data = (await r.json()) as { success: boolean; error?: string };
        if (!r.ok || !data.success) throw new Error(data.error ?? `HTTP ${r.status}`);
        await loadDesktopStatus();
        await loadHealth();
      } catch (e) {
        setDesktopError(e instanceof Error ? e.message : String(e));
      } finally {
        setSyncingR2(false);
      }
    },
    [loadDesktopStatus, loadHealth],
  );

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
    setActiveTab("overview");
  }, [isOpen, loadDesktopStatus, loadHealth]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [isOpen, onClose]);

  const isDesktop = Boolean(desktop);
  const visibleTabs = isDesktop ? SETTINGS_TABS_DESKTOP : SETTINGS_TABS_BROWSER;

  useEffect(() => {
    if (!isOpen) return;
    if (!visibleTabs.some((t) => t.id === activeTab)) {
      setActiveTab("overview");
    }
  }, [isOpen, activeTab, visibleTabs]);

  const safeTab = visibleTabs.some((t) => t.id === activeTab) ? activeTab : "overview";

  if (!isOpen) return null;

  const claimed = health?.claimed_count ?? 0;
  const missing = health?.missing_ids ?? [];
  const ver = health?.version ? health.version.slice(0, 8) : "?";
  const onDiskCount = Math.max(0, claimed - missing.length);
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
  const catalogHealthBlocked = Boolean(healthError) || (r2EnabledFlag && r2ErrorCount > 0);
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

  const desktopStatusKeys = desktopStatus?.keys ?? EMPTY_KEYS;

  return (
    <div
      className="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-title"
      aria-describedby="settings-description"
    >
      <div className="modal-backdrop" onClick={onClose} />
      <div
        className="modal-dialog modal-dialog--settings"
        aria-busy={saving || desktopLoading || exportR2JobsLoading || clearCacheBusy}
      >
        {saving ? (
          <div className="settings-reloading" role="status">
            שומר ומרענן את השרת המקומי…
          </div>
        ) : null}
        <header className="modal-header">
          <h2 className="modal-title" id="settings-title">
            הגדרות
          </h2>
          <button className="modal-close" type="button" aria-label="סגור" onClick={onClose}>
            ×
          </button>
        </header>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (isDesktop && !saving && !desktopLoading) void saveDesktopSettings();
          }}
        >
          <div className="settings-modal-intro">
            <p id="settings-description" className="settings-modal-intro__text">
              בדיקה מהירה של מצב הקטלוג, הדסקטופ, מפתחות ה-AI והסנכרון לענן.
            </p>
          </div>
          <div className="settings-modal-tabstrip" role="tablist" aria-label="סעיפי הגדרות">
            {visibleTabs.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`settings-tab-${t.id}`}
                aria-selected={safeTab === t.id}
                aria-controls={`settings-panel-${t.id}`}
                className={`settings-modal-tab ${safeTab === t.id ? "is-active" : undefined}`}
                onClick={() => setActiveTab(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="modal-body modal-body--settings-tabs">
            <div
              className="settings-modal-tabpanel"
              role="tabpanel"
              id="settings-panel-overview"
              aria-labelledby="settings-tab-overview"
              hidden={safeTab !== "overview"}
            >
              <SettingsOverviewPanel
                healthLoading={healthLoading}
                catalogKnown={catalogKnown}
                claimed={claimed}
                catalogDotVariant={catalogDotVariant}
                catalogStatHint={catalogStatHint}
                desktopLoading={desktopLoading}
                isDesktop={isDesktop}
                workspaceReady={workspaceReady}
                workspaceDir={desktopStatus?.workspace.workspaceDir}
                configuredKeysCount={configuredKeysCount}
                r2Ready={r2Ready}
                desktopR2={desktopStatus?.r2}
              />
            </div>

            <div
              className="settings-modal-tabpanel"
              role="tabpanel"
              id="settings-panel-catalog"
              aria-labelledby="settings-tab-catalog"
              hidden={safeTab !== "catalog"}
            >
              <SettingsCatalogPanel
                onRefreshHealth={loadHealth}
                healthLoading={healthLoading}
                healthError={healthError}
                health={health}
                claimed={claimed}
                missing={missing}
                ver={ver}
                onDiskCount={onDiskCount}
                catalogDotVariant={catalogDotVariant}
              />
              {!isDesktop ? (
                <section className="settings-section settings-section--browser-note">
                  <div className="catalog-card">
                    <span className="dot is-missing" />
                    <span>
                      טאב דסקטופ, AI וענן מוצגים רק בעת הפעלה דרך אפליקציית WeatherV1 (Electron).
                    </span>
                  </div>
                </section>
              ) : null}
            </div>

            {isDesktop ? (
              <div
                className="settings-modal-tabpanel"
                role="tabpanel"
                id="settings-panel-desktop"
                aria-labelledby="settings-tab-desktop"
                hidden={safeTab !== "desktop"}
              >
                <SettingsDesktopPanel
                  saved={saved}
                  onRefreshDesktopStatus={loadDesktopStatus}
                  desktopLoading={desktopLoading}
                  saving={saving}
                  desktopError={desktopError}
                  desktopStatus={desktopStatus}
                  appInfo={appInfo}
                  updateState={updateState}
                  workspaceReady={workspaceReady}
                  ffmpegReady={ffmpegReady}
                  onPickWorkspace={pickWorkspace}
                  workspaceDir={workspaceDir}
                  onWorkspaceDirChange={(v) => {
                    setWorkspaceDir(v);
                    setSaved(false);
                  }}
                  ffmpegPath={ffmpegPath}
                  ffprobePath={ffprobePath}
                  onFfmpegPathChange={(v) => {
                    setFfmpegPath(v);
                    setSaved(false);
                  }}
                  onFfprobePathChange={(v) => {
                    setFfprobePath(v);
                    setSaved(false);
                  }}
                  onResetWorkspaceToDefault={resetWorkspaceToDefault}
                  onClearDerivedCache={clearDerivedCache}
                  clearCacheBusy={clearCacheBusy}
                  onBeginUninstall={beginUninstall}
                  uninstallBusy={uninstallBusy}
                />
              </div>
            ) : null}

            {isDesktop ? (
              <div
                className="settings-modal-tabpanel"
                role="tabpanel"
                id="settings-panel-ai"
                aria-labelledby="settings-tab-ai"
                hidden={safeTab !== "ai"}
              >
                <SettingsAiPanel
                  desktopStatusKeys={desktopStatusKeys}
                  saving={saving}
                  anthropicKey={anthropicKey}
                  openaiKey={openaiKey}
                  geminiKey={geminiKey}
                  onAnthropicKeyChange={(v) => {
                    setAnthropicKey(v);
                    setSaved(false);
                  }}
                  onOpenaiKeyChange={(v) => {
                    setOpenaiKey(v);
                    setSaved(false);
                  }}
                  onGeminiKeyChange={(v) => {
                    setGeminiKey(v);
                    setSaved(false);
                  }}
                  onClearKey={(provider) => void clearKey(provider)}
                  llmProvider={llmProvider}
                  onLlmProviderChange={(pref) => {
                    setLlmProvider(pref);
                    setSaved(false);
                  }}
                />
              </div>
            ) : null}

            {isDesktop ? (
              <div
                className="settings-modal-tabpanel"
                role="tabpanel"
                id="settings-panel-cloud"
                aria-labelledby="settings-tab-cloud"
                hidden={safeTab !== "cloud"}
              >
                <SettingsCloudPanel
                  appInfo={appInfo}
                  desktopStatus={desktopStatus}
                  saving={saving}
                  syncingR2={syncingR2}
                  exportR2JobsLoading={exportR2JobsLoading}
                  r2Enabled={r2Enabled}
                  r2GatewayUrl={r2GatewayUrl}
                  r2TenantId={r2TenantId}
                  r2BucketName={r2BucketName}
                  r2AppUsername={r2AppUsername}
                  r2AppPassword={r2AppPassword}
                  showR2Password={showR2Password}
                  onR2GatewayUrlChange={(v) => {
                    setR2GatewayUrl(v);
                    setSaved(false);
                  }}
                  onR2TenantIdChange={(v) => {
                    setR2TenantId(v);
                    setSaved(false);
                  }}
                  onR2BucketNameChange={(v) => {
                    setR2BucketName(v);
                    setSaved(false);
                  }}
                  onR2AppUsernameChange={(v) => {
                    setR2AppUsername(v);
                    setSaved(false);
                  }}
                  onR2AppPasswordChange={(v) => {
                    setR2AppPassword(v);
                    setSaved(false);
                  }}
                  onR2EnabledChange={(enabled) => {
                    setR2Enabled(enabled);
                    setSaved(false);
                  }}
                  onShowR2PasswordToggle={() => setShowR2Password((v) => !v)}
                  onClearR2Key={() => void clearKey("r2")}
                  onPullCatalogFromR2={pullCatalogFromR2}
                  onPushCatalogToR2={(replace) => void pushCatalogToR2(replace)}
                  onExportJobsFromR2={exportJobsFromR2}
                />
              </div>
            ) : null}
          </div>
          <footer className="modal-footer">
            {isDesktop ? (
              <button className="btn" type="submit" disabled={saving || desktopLoading}>
                {saving ? "שומר…" : "שמור דסקטופ"}
              </button>
            ) : null}
            <button className="btn btn--ghost" type="button" onClick={onClose}>
              סגור
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
