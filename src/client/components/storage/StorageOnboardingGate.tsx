"use client";

import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { desktop } from "@/client/lib/desktop";
import { useStorageStatus } from "@/client/hooks/useStorageStatus";
import type { DesktopAppInfo } from "@/shared/desktop";
import { AppBootstrapShell } from "@/client/components/storage/AppBootstrapShell";
import { dispatchRefetchJobs } from "@/client/hooks/useLocalHistory";

// `cloud-connect` was a second-screen R2 sign-in form. Editor login now
// persists the same (username, password) as R2 Worker creds, so we no
// longer need a dedicated screen for it. If R2 stays unready after that
// (e.g. Worker rejected the password), we surface a "reconnect" overlay
// with a sign-out fallback instead of asking for the password twice.
type Phase = "loading" | "cloud-reconnect" | "local-cache" | "ready" | "hidden";

function RtlTechnicalLine({
  className,
  role,
  prefix,
  message,
}: {
  className: string;
  role?: "alert";
  prefix: string;
  message: string;
}) {
  return (
    <p className={className} role={role}>
      {prefix}{" "}
      <span dir="ltr">{message}</span>
    </p>
  );
}

export function StorageOnboardingGate() {
  const { data: storage, refetch } = useStorageStatus();
  const qc = useQueryClient();
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [appInfoReady, setAppInfoReady] = useState(false);

  const [signingOut, setSigningOut] = useState(false);
  const [pickingCache, setPickingCache] = useState(false);
  const [cacheError, setCacheError] = useState<string | null>(null);

  useEffect(() => {
    if (!desktop) {
      setAppInfoReady(true);
      return;
    }
    let cancelled = false;
    void desktop
      .getAppInfo()
      .then((info) => {
        if (!cancelled) {
          setAppInfo(info);
          setAppInfoReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) setAppInfoReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const refreshEverything = useCallback(async () => {
    await Promise.all([
      refetch(),
      qc.invalidateQueries({ queryKey: ["catalog"] }),
      qc.invalidateQueries({ queryKey: ["r2-sync-status"] }),
    ]);
    if (typeof window !== "undefined") {
      dispatchRefetchJobs();
    }
  }, [refetch, qc]);

  // Recovery path when R2 stays unready after the editor login propagated
  // creds (e.g. Worker rejected the password). Clearing the editor session
  // forces the user back through EditorLoginGate, which will re-save the
  // creds. The hard reload guarantees a fresh probe.
  const handleSignOutToRetry = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/auth/sign-out", { method: "POST" });
      if (desktop?.clearEditorSession) {
        try {
          await desktop.clearEditorSession();
        } catch {
          // Non-fatal: cookie is gone either way.
        }
      }
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    } catch {
      setSigningOut(false);
    }
  }, [signingOut]);

  const handleUseDefaultCache = useCallback(async () => {
    if (!desktop) return;
    setPickingCache(true);
    setCacheError(null);
    try {
      // Empty workspaceDir tells main.cjs to fall back to the app-managed
      // default local cache under userData. config.cjs treats `null` /
      // missing workspaceDir that way.
      await desktop.saveSettings({ workspaceDir: "" });
      await refreshEverything();
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickingCache(false);
    }
  }, [refreshEverything]);

  const handlePickFolder = useCallback(async () => {
    if (!desktop) return;
    setPickingCache(true);
    setCacheError(null);
    try {
      const picked = await desktop.pickWorkspace();
      if (picked) {
        await desktop.saveSettings({ workspaceDir: picked.path });
        await refreshEverything();
      }
    } catch (err) {
      setCacheError(err instanceof Error ? err.message : String(err));
    } finally {
      setPickingCache(false);
    }
  }, [refreshEverything]);

  const phase = derivePhase({ desktopAvailable: Boolean(desktop), appInfo, appInfoReady, storage });

  if (phase === "loading") {
    return (
      <AppBootstrapShell
        title="טוען…"
        subtitle="טוען את הגדרות האחסון והענן…"
      />
    );
  }

  if (phase === "hidden" || phase === "ready") return null;

  if (phase === "cloud-reconnect") {
    const versionLine = appInfo
      ? `WeatherV1 · גרסה ${appInfo.appVersion}`
      : "WeatherV1";
    return (
      <div
        className="login-screen"
        dir="rtl"
        lang="he"
        role="dialog"
        aria-modal="true"
        aria-labelledby="cloud-reconnect-title"
      >
        <div className="login-screen__backdrop" aria-hidden="true" />
        <div className="login-card">
          <div className="login-card__brand" aria-hidden="true">
            <span className="login-card__brand-mark">WV1</span>
          </div>
          <h1 className="login-card__title" id="cloud-reconnect-title">
            לא ניתן להתחבר לענן
          </h1>
          <p className="login-card__subtitle">
            פרטי החיבור ל־Cloudflare R2 נשמרו בעת הכניסה לעורך אך השרת דחה אותם. התנתקו והיכנסו
            שוב כדי לנסות מחדש.
          </p>

          {storage?.cloud.error && (
            <RtlTechnicalLine
              className="login-card__error"
              role="alert"
              prefix="פרטים טכניים:"
              message={storage.cloud.error}
            />
          )}

          <div className="login-card__form">
            <button
              type="button"
              className="btn btn--primary login-card__submit"
              onClick={() => void handleSignOutToRetry()}
              disabled={signingOut}
            >
              {signingOut ? "מתנתק…" : "התנתק והיכנס מחדש"}
            </button>
          </div>

          <footer className="login-card__footer">
            <span>{versionLine}</span>
            <span aria-hidden="true">·</span>
            <span>Cloudflare R2</span>
          </footer>
        </div>
      </div>
    );
  }

  if (phase === "local-cache") {
    return (
      <section
        className="storage-gate storage-gate--cache"
        role="region"
        dir="rtl"
        lang="he"
        aria-label="בחירת תיקיית מטמון מקומית"
      >
        <div className="storage-gate__copy">
          <span className="storage-gate__step">שלב 2 מתוך 2</span>
          <h2>בחירת תיקיית מטמון מקומית</h2>
          <p>
            WeatherV1 יוריד לתיקייה זו קטעים, פוסטרים, העלאות ורינדורים. זו תיקיית מטמון של ספריית
            הענן — לא המקור הרשמי.
          </p>
          {storage?.localCache.workspaceDir && (
            <p className="storage-gate__hint">
              נוכחי: <code dir="ltr">{storage.localCache.workspaceDir}</code>
              {storage.localCache.missing.length > 0 && (
                <>
                  {" "}
                  · חסרים:{" "}
                  <span dir="ltr">{storage.localCache.missing.join(", ")}</span>
                </>
              )}
            </p>
          )}
          {cacheError && (
            <RtlTechnicalLine
              className="storage-gate__error"
              prefix="אירעה שגיאה:"
              message={cacheError}
            />
          )}
        </div>
        <div className="storage-gate__form">
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => void handleUseDefaultCache()}
            disabled={pickingCache}
          >
            {pickingCache ? "עובד…" : "השתמש במטמון המקומי כברירת מחדל"}
          </button>
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void handlePickFolder()}
            disabled={pickingCache}
          >
            בחר תיקייה…
          </button>
        </div>
      </section>
    );
  }

  return null;
}

function derivePhase(args: {
  desktopAvailable: boolean;
  appInfo: DesktopAppInfo | null;
  appInfoReady: boolean;
  storage: ReturnType<typeof useStorageStatus>["data"];
}): Phase {
  const { desktopAvailable, appInfo, appInfoReady, storage } = args;

  // Don't render anything in browser-only / non-desktop contexts.
  if (!desktopAvailable) return "hidden";
  if (!appInfoReady || !storage) return "loading";

  // Only the packaged production build defaults to cloud-first onboarding.
  // Dev / unpackaged users keep the local-only flow and Settings.
  const isProductionShell = Boolean(appInfo?.packaged);
  if (!isProductionShell) return "hidden";

  if (storage.mode !== "cloud") return "hidden";

  // Cloud creds come from the editor login (same username/password); a
  // mismatch surfaces here as cloud.ready === false. Show the recovery
  // overlay only when the Worker actually reported an error — a transient
  // not-yet-probed state shouldn't block the app.
  if (!storage.cloud.ready && storage.cloud.error) return "cloud-reconnect";
  if (!storage.localCache.ready) return "local-cache";
  return "ready";
}
