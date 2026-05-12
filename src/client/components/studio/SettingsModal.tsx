"use client";
import { useCallback, useEffect, useState } from "react";
import { desktop } from "@/client/lib/desktop";
import type {
  DesktopAppInfo,
  DesktopSettingsUpdate,
  DesktopUpdateState,
  LlmProviderPreference,
  TranscriptionProviderPreference,
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
    transcription_pref: TranscriptionProviderPreference;
  };
  whisper?: {
    active_model: WhisperModelId | null;
    installed_models: WhisperModelId[];
    local_ready: boolean;
    local_supported: boolean;
    platform: string;
    arch: string;
  };
  ffmpeg: {
    ffmpeg_path: string | null;
    ffprobe_path: string | null;
    bg_music_path: string;
  };
  catalog_store?: {
    kind: "local" | "google-drive";
    enabled: boolean;
    ready: boolean;
    rootFolderId?: string;
    catalogFileId?: string;
    lastKnownModifiedTime?: string;
    lastSyncAt?: string;
    error?: string;
  };
}

type WhisperModelId = "small" | "medium" | "large-v3-turbo";

interface WhisperModelEntry {
  id: WhisperModelId;
  repo: string;
  size_bytes: number;
  description_he: string;
  quality_he: string;
  installed: boolean;
  disk_bytes: number;
  verified: boolean;
  is_active: boolean;
}

interface WhisperModelsResponse {
  success: boolean;
  models: WhisperModelEntry[];
  cache_dir: string;
  active_model_id: WhisperModelId | null;
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

function formatBytes(bytes: number): string {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
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
  const [googleClientId, setGoogleClientId] = useState("");
  const [googleDriveEnabled, setGoogleDriveEnabled] = useState(false);
  const [llmProvider, setLlmProvider] = useState<LlmProviderPreference>("auto");
  const [transcriptionProvider, setTranscriptionProvider] =
    useState<TranscriptionProviderPreference>("auto");
  const [whisperModels, setWhisperModels] = useState<WhisperModelEntry[]>([]);
  const [whisperLoading, setWhisperLoading] = useState(false);
  const [whisperError, setWhisperError] = useState<string | null>(null);
  const [whisperCacheDir, setWhisperCacheDir] = useState<string | null>(null);
  const [downloadingModel, setDownloadingModel] = useState<WhisperModelId | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<{
    modelId: WhisperModelId;
    bytesDownloaded: number;
    bytesTotal: number;
  } | null>(null);
  const [saving, setSaving] = useState(false);
  const [connectingDrive, setConnectingDrive] = useState(false);
  const [syncingDrive, setSyncingDrive] = useState(false);
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
        setTranscriptionProvider(status.providers.transcription_pref);
      }
      setGoogleDriveEnabled(Boolean(status.catalog_store?.enabled));
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setDesktopLoading(false);
    }
  }, []);

  const loadWhisperModels = useCallback(async () => {
    setWhisperLoading(true);
    setWhisperError(null);
    try {
      const modelsRes = await fetch("/api/whisper/models");
      const modelsData = (await modelsRes.json()) as WhisperModelsResponse;
      if (!modelsRes.ok || !modelsData.success) throw new Error(`HTTP ${modelsRes.status}`);
      setWhisperModels(modelsData.models);
      setWhisperCacheDir(modelsData.cache_dir ?? null);
    } catch (e) {
      setWhisperError(e instanceof Error ? e.message : String(e));
    } finally {
      setWhisperLoading(false);
    }
  }, []);

  const downloadWhisperModel = useCallback(
    async (id: WhisperModelId) => {
      if (downloadingModel) return;
      setDownloadingModel(id);
      setDownloadProgress({ modelId: id, bytesDownloaded: 0, bytesTotal: 0 });
      setWhisperError(null);
      try {
        const res = await fetch("/api/whisper/models", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model_id: id }),
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // SSE frames are separated by blank lines.
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            if (frame.startsWith("event: error")) {
              const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
              const payload = dataLine ? JSON.parse(dataLine.slice(5).trim()) : { error: "unknown" };
              throw new Error(String((payload as { error?: unknown }).error ?? "download failed"));
            }
            if (frame.startsWith("event: done")) continue;
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;
            const payload = JSON.parse(dataLine.slice(5).trim()) as {
              modelId: WhisperModelId;
              bytesDownloaded: number;
              bytesTotal: number;
            };
            setDownloadProgress(payload);
          }
        }
        await loadWhisperModels();
      } catch (e) {
        setWhisperError(e instanceof Error ? e.message : String(e));
      } finally {
        setDownloadingModel(null);
        setDownloadProgress(null);
      }
    },
    [downloadingModel, loadWhisperModels],
  );

  const deleteWhisperModel = useCallback(
    async (id: WhisperModelId) => {
      try {
        const r = await fetch(`/api/whisper/models?model_id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });
        const data = (await r.json()) as { success: boolean; error?: string };
        if (!data.success) throw new Error(data.error ?? "delete failed");
        await loadWhisperModels();
      } catch (e) {
        setWhisperError(e instanceof Error ? e.message : String(e));
      }
    },
    [loadWhisperModels],
  );

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
      if (googleClientId.trim()) update.googleClientId = googleClientId.trim();
      update.googleDriveEnabled = googleDriveEnabled;
      update.llmProvider = llmProvider;
      update.transcriptionProvider = transcriptionProvider;

      await desktop.saveSettings(update);
      setOpenaiKey("");
      setAnthropicKey("");
      setGeminiKey("");
      await loadDesktopStatus();
      await loadHealth();
      await loadWhisperModels();
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
    googleClientId,
    googleDriveEnabled,
    llmProvider,
    loadDesktopStatus,
    loadHealth,
    loadWhisperModels,
    openaiKey,
    transcriptionProvider,
    workspaceDir,
  ]);

  const connectGoogleDrive = useCallback(async () => {
    if (!desktop) return;
    setConnectingDrive(true);
    setDesktopError(null);
    try {
      if (googleClientId.trim()) {
        await desktop.saveSettings({
          googleClientId: googleClientId.trim(),
          googleDriveEnabled: true,
        });
      }
      await desktop.connectGoogleDrive();
      await loadDesktopStatus();
      await loadHealth();
      setGoogleDriveEnabled(true);
      setSaved(true);
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnectingDrive(false);
    }
  }, [googleClientId, loadDesktopStatus, loadHealth]);

  const syncCatalogFromDrive = useCallback(async () => {
    setSyncingDrive(true);
    setDesktopError(null);
    try {
      const r = await fetch("/api/catalog/sync", { method: "POST" });
      const data = (await r.json()) as { success: boolean; error?: string };
      if (!r.ok || !data.success) throw new Error(data.error ?? `HTTP ${r.status}`);
      await loadDesktopStatus();
      await loadHealth();
    } catch (e) {
      setDesktopError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingDrive(false);
    }
  }, [loadDesktopStatus, loadHealth]);

  useEffect(() => {
    if (!isOpen) return;
    void loadHealth();
    void loadDesktopStatus();
    void loadWhisperModels();
  }, [isOpen, loadDesktopStatus, loadHealth, loadWhisperModels]);

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
                  <StatusDot ok={Boolean(desktopStatus?.whisper?.local_ready)} />
                  <span>Whisper מקומי</span>
                  <span>
                    {desktopStatus?.whisper?.local_supported === false
                      ? "לא נתמך בגרסה הזו"
                      : desktopStatus?.whisper?.local_ready
                        ? `מוכן · ${desktopStatus.whisper.active_model ?? ""}`
                        : "הורד מודל בהגדרות"}
                  </span>
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
                  <StatusDot ok={Boolean(desktopStatus?.catalog_store?.ready)} />
                  <span>Google Drive</span>
                  <span>
                    {desktopStatus?.catalog_store?.kind === "google-drive"
                      ? `מחובר · ${desktopStatus.catalog_store.lastSyncAt ? "סונכרן" : "ממתין לסנכרון"}`
                      : "לא פעיל"}
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
                <h3>Google Drive Catalog</h3>
                <button
                  type="button"
                  className="settings-link"
                  onClick={() => void syncCatalogFromDrive()}
                  disabled={syncingDrive || !desktopStatus?.catalog_store?.enabled}
                >
                  {syncingDrive ? "מסנכרן…" : "משוך קטלוג"}
                </button>
              </div>
              <p className="settings-hint">
                הקטלוג מסתנכרן ל-WeatherV1/catalog.json בדרייב. קבצי וידאו נשארים מקומיים בשלב הזה.
              </p>
              <label className="settings-field">
                <span>OAuth Client ID</span>
                <input
                  value={googleClientId}
                  onChange={(e) => {
                    setGoogleClientId(e.target.value);
                    setSaved(false);
                  }}
                  placeholder="Google Desktop OAuth client ID"
                />
              </label>
              <label className="settings-radio">
                <input
                  type="checkbox"
                  checked={googleDriveEnabled}
                  onChange={(e) => {
                    setGoogleDriveEnabled(e.target.checked);
                    setSaved(false);
                  }}
                />
                <span>הפעל סנכרון קטלוג ל-Google Drive</span>
              </label>
              <div className="settings-model-row__actions">
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => void connectGoogleDrive()}
                  disabled={connectingDrive || saving}
                >
                  {connectingDrive ? "מתחבר…" : "חבר Google Drive"}
                </button>
              </div>
              {desktopStatus?.catalog_store?.catalogFileId && (
                <p className="settings-hint">
                  catalog.json: {desktopStatus.catalog_store.catalogFileId}
                </p>
              )}
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>מפתחות API</h3>
              </div>
              <p className="settings-hint">
                הזן לפחות מפתח אחד מבין Anthropic או OpenAI. השרת בוחר ספק על פי מה שמוגדר; אפשר לכפות בחירה בחלונית למטה.
              </p>
              <label className="settings-field">
                <span>ANTHROPIC_API_KEY</span>
                <input
                  type="password"
                  value={anthropicKey}
                  onChange={(e) => {
                    setAnthropicKey(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={
                    desktopStatus?.keys.anthropic_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"
                  }
                />
              </label>
              <label className="settings-field">
                <span>OPENAI_API_KEY</span>
                <input
                  type="password"
                  value={openaiKey}
                  onChange={(e) => {
                    setOpenaiKey(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={
                    desktopStatus?.keys.openai_configured ? "מוגדר — הקלד כדי להחליף" : "לא מוגדר"
                  }
                />
              </label>
              <label className="settings-field">
                <span>GEMINI_API_KEY</span>
                <input
                  type="password"
                  value={geminiKey}
                  onChange={(e) => {
                    setGeminiKey(e.target.value);
                    setSaved(false);
                  }}
                  placeholder={
                    desktopStatus?.keys.gemini_configured ? "מוגדר — הקלד כדי להחליף" : "אופציונלי"
                  }
                />
              </label>
            </section>
          )}

          {isDesktop && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>בחירת ספק</h3>
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
              <fieldset className="settings-field">
                <legend>ספק תמלול אודיו</legend>
                {(
                  [
                    ["auto", "אוטומטי — Whisper מקומי אם מותקן, אחרת OpenAI"],
                    ["local-whisper-onnx", "Whisper מקומי (ONNX — ללא התקנה)"],
                    ["openai-cloud", "OpenAI Whisper (ענן)"],
                  ] as Array<[TranscriptionProviderPreference, string]>
                ).map(([id, label]) => {
                  // Disable the local option on platforms without an
                  // onnxruntime-node prebuild (today: macOS x64 build under
                  // Rosetta). Auto stays available but will fall through to
                  // cloud automatically; the hint below explains why.
                  const localDisabled =
                    id === "local-whisper-onnx" &&
                    desktopStatus?.whisper?.local_supported === false;
                  return (
                    <label
                      key={id}
                      className={`settings-radio${localDisabled ? " is-disabled" : ""}`}
                    >
                      <input
                        type="radio"
                        name="transcription-provider"
                        value={id}
                        checked={transcriptionProvider === id}
                        disabled={localDisabled}
                        onChange={() => {
                          setTranscriptionProvider(id);
                          setSaved(false);
                        }}
                      />
                      <span>{label}</span>
                    </label>
                  );
                })}
                {desktopStatus?.whisper?.local_supported === false && (
                  <p className="settings-hint">
                    Whisper מקומי לא נתמך בגרסת ה-Mac הנוכחית ({desktopStatus.whisper.platform}/
                    {desktopStatus.whisper.arch}). השתמש ב-OpenAI Whisper בענן.
                  </p>
                )}
              </fieldset>
            </section>
          )}

          {isDesktop && desktopStatus?.whisper?.local_supported !== false && (
            <section className="settings-section">
              <div className="settings-section-header">
                <h3>מודלי Whisper מקומיים</h3>
                <button
                  type="button"
                  className="settings-link"
                  onClick={loadWhisperModels}
                  disabled={whisperLoading}
                >
                  רענן
                </button>
              </div>
              {whisperError && (
                <div className="catalog-card">
                  <span className="dot is-missing" />
                  <span>שגיאה במודלים: {whisperError}</span>
                </div>
              )}
              <p className="settings-hint">
                התמלול המקומי רץ דרך transformers.js (ONNX) — לא צריך להתקין שום תוכנה. בחר מודל
                לפי תקציב דיסק וכוח עיבוד. עברית עובדת מ-small ומעלה; medium הוא הברירה המומלצת.
                {whisperCacheDir ? ` הקבצים נשמרים תחת ${shortPath(whisperCacheDir)}.` : null}
              </p>
              <ul className="settings-models">
                {whisperModels.map((m) => {
                  const isDownloading = downloadingModel === m.id;
                  const progress =
                    isDownloading && downloadProgress && downloadProgress.modelId === m.id
                      ? downloadProgress
                      : null;
                  const pct =
                    progress && progress.bytesTotal > 0
                      ? Math.min(100, Math.floor((progress.bytesDownloaded / progress.bytesTotal) * 100))
                      : 0;
                  return (
                    <li key={m.id} className="settings-model-row">
                      <div className="settings-model-row__head">
                        <StatusDot ok={m.installed} />
                        <strong>{m.id}</strong>
                        <span className="settings-model-row__quality">{m.quality_he}</span>
                        {m.is_active && <span className="settings-saved-pill">פעיל</span>}
                      </div>
                      <div className="settings-model-row__desc">
                        {m.description_he} · {formatBytes(m.size_bytes)}
                      </div>
                      {isDownloading && progress && (
                        <div className="settings-model-row__progress">
                          <div
                            className="settings-model-row__progress-bar"
                            style={{ width: `${pct}%` }}
                          />
                          <span>
                            {pct}% · {formatBytes(progress.bytesDownloaded)} / {formatBytes(progress.bytesTotal || m.size_bytes)}
                          </span>
                        </div>
                      )}
                      <div className="settings-model-row__actions">
                        {!m.installed && (
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => void downloadWhisperModel(m.id)}
                            disabled={Boolean(downloadingModel)}
                          >
                            {isDownloading ? "מוריד…" : "הורד"}
                          </button>
                        )}
                        {m.installed && !m.is_active && (
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => void deleteWhisperModel(m.id)}
                            disabled={Boolean(downloadingModel)}
                          >
                            מחק
                          </button>
                        )}
                        {m.installed && m.is_active && (
                          <button
                            type="button"
                            className="btn btn--ghost"
                            onClick={() => void deleteWhisperModel(m.id)}
                            disabled={Boolean(downloadingModel)}
                            title="מחיקת המודל הפעיל תאלץ את המערכת לבחור מודל אחר או לעבור לתמלול בענן"
                          >
                            מחק
                          </button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
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
