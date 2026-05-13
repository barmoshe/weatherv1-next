"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { desktop } from "@/client/lib/desktop";
import { useStorageStatus } from "@/client/hooks/useStorageStatus";
import type { DesktopAppInfo } from "@/shared/desktop";

type Phase = "loading" | "cloud-connect" | "cloud-ready" | "local-cache" | "ready" | "hidden";

const LAST_USERNAME_KEY = "weatherv1.r2.lastUsername";

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

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [signInError, setSignInError] = useState<string | null>(null);
  const [signInOk, setSignInOk] = useState(false);

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

  // Pre-fill username from (a) the saved value the server already knows,
  // or (b) localStorage cache from a prior session, or (c) blank.
  useEffect(() => {
    if (username) return;
    const fromServer = storage?.cloud.appUsername?.trim();
    if (fromServer) {
      setUsername(fromServer);
      return;
    }
    if (typeof window !== "undefined") {
      const cached = window.localStorage.getItem(LAST_USERNAME_KEY);
      if (cached) setUsername(cached);
    }
  }, [storage?.cloud.appUsername, username]);

  const refreshEverything = useCallback(async () => {
    await Promise.all([
      refetch(),
      qc.invalidateQueries({ queryKey: ["catalog"] }),
      qc.invalidateQueries({ queryKey: ["r2-sync-status"] }),
    ]);
  }, [refetch, qc]);

  const handleSignIn = useCallback(async () => {
    if (!desktop) return;
    const trimmedUser = username.trim();
    const trimmedPass = password;
    if (!trimmedUser || !trimmedPass) return;
    setSubmitting(true);
    setSignInOk(false);
    setSignInError(null);
    try {
      await desktop.saveSettings({
        r2AppUsername: trimmedUser,
        r2AppPassword: trimmedPass,
      });
      if (typeof window !== "undefined") {
        window.localStorage.setItem(LAST_USERNAME_KEY, trimmedUser);
      }
      setPassword("");
      setSignInOk(true);
      await refreshEverything();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }, [username, password, refreshEverything]);

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

  const canSubmit = useMemo(
    () => Boolean(username.trim() && password && !submitting),
    [username, password, submitting],
  );

  if (phase === "hidden" || phase === "ready") return null;
  if (phase === "loading") return null;

  if (phase === "cloud-connect") {
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
        aria-labelledby="login-title"
      >
        <div className="login-screen__backdrop" aria-hidden="true" />
        <div className="login-card">
          <div className="login-card__brand" aria-hidden="true">
            <span className="login-card__brand-mark">WV1</span>
          </div>
          <h1 className="login-card__title" id="login-title">
            כניסה ל־WeatherV1
          </h1>
          <p className="login-card__subtitle">
            חברו את אפליקציית השולחן לקטלוג Cloudflare R2. פרטי ההתחברות נשמרים במחסנית המפתחות של
            מערכת ההפעלה ונשלחים רק ל־Worker של WeatherV1.
          </p>

          <form
            className="login-card__form"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSignIn();
            }}
          >
            <label className="login-field">
              <span className="login-field__label">שם משתמש</span>
              <input
                className="login-field__input"
                type="text"
                value={username}
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="none"
                autoCorrect="off"
                onChange={(event) => {
                  setUsername(event.target.value);
                  setSignInOk(false);
                }}
                placeholder="weatherv1"
                disabled={submitting}
                aria-required="true"
              />
            </label>

            <label className="login-field">
              <span className="login-field__label">סיסמה</span>
              <div className="login-field__password">
                <input
                  className="login-field__input"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  autoComplete="current-password"
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setSignInOk(false);
                  }}
                  placeholder="••••••••"
                  disabled={submitting}
                  aria-required="true"
                />
                <button
                  type="button"
                  className="login-field__toggle"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "הסתרת סיסמה" : "הצגת סיסמה"}
                  aria-pressed={showPassword}
                >
                  {showPassword ? "הסתר" : "הצג"}
                </button>
              </div>
            </label>

            {storage?.cloud.gatewayUrl && (
              <p className="login-card__hint">
                שער (URL): <code dir="ltr">{storage.cloud.gatewayUrl}</code>
              </p>
            )}

            {storage?.cloud.error && !signInError && !signInOk && (
              <RtlTechnicalLine
                className="login-card__error"
                role="alert"
                prefix="לא ניתן להתחבר:"
                message={storage.cloud.error}
              />
            )}
            {signInError && (
              <RtlTechnicalLine
                className="login-card__error"
                role="alert"
                prefix="לא ניתן להתחבר:"
                message={signInError}
              />
            )}
            {signInOk && (
              <p className="login-card__ok" role="status">
                מחובר. טוען את הקטלוג…
              </p>
            )}

            <button
              type="submit"
              className="btn btn--primary login-card__submit"
              disabled={!canSubmit}
            >
              {submitting ? "מתחבר…" : "התחברות"}
            </button>
          </form>

          <footer className="login-card__footer">
            <span>{versionLine}</span>
            <span aria-hidden="true">·</span>
            <span>Cloudflare R2 · אימות בסיסי</span>
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

  if (!storage.cloud.ready) return "cloud-connect";
  if (!storage.localCache.ready) return "local-cache";
  return "ready";
}
