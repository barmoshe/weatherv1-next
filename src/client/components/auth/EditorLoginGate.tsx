"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { desktop } from "@/client/lib/desktop";
import { ErrorBanner } from "@/client/components/common/ErrorBanner";
import type { UiError } from "@/shared/errors";

// Fallback used only until /api/auth/me responds with the canonical
// build-time username. The disabled username field is informational; the
// server validates against its own constant regardless of what we display.
const FALLBACK_USERNAME = "v1editor";

type Phase = "probing" | "needs-login" | "authenticated";

interface EditorLoginGateProps {
  children: ReactNode;
}

export function EditorLoginGate({ children }: EditorLoginGateProps) {
  const [phase, setPhase] = useState<Phase>("probing");
  const [username, setUsername] = useState<string>(FALLBACK_USERNAME);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<UiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean; username?: string };
        if (cancelled) return;
        if (typeof data.username === "string" && data.username) {
          setUsername(data.username);
        }
        setPhase(data.ok ? "authenticated" : "needs-login");
      } catch {
        if (cancelled) return;
        setPhase("needs-login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = useCallback(async () => {
    if (submitting || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/editor-login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        username?: string;
        error?: string;
      };
      if (!data.success || !data.token) {
        setError({
          message: data.error || "סיסמה שגויה",
          code: res.status === 401 ? "invalid_password" : `http_${res.status}`,
          step: "login",
        });
        setSubmitting(false);
        return;
      }
      const canonicalUsername =
        typeof data.username === "string" && data.username
          ? data.username
          : username;
      // Desktop only: persist the same (username, password) pair as R2
      // Worker Basic Auth credentials. This collapses the second cloud
      // sign-in screen into the editor login. If saveSettings fails the
      // user can still recover via Settings → Cloud.
      if (desktop) {
        try {
          await desktop.saveSettings({
            r2AppUsername: canonicalUsername,
            r2AppPassword: password,
          });
        } catch {
          // Non-fatal. Cloud sync will show a banner if R2 stays unready.
        }
        if (desktop.setEditorSession) {
          try {
            await desktop.setEditorSession({ token: data.token });
          } catch {
            // Persistence failure is non-fatal — the cookie still
            // authenticates this session. Worst case: relaunch shows the
            // gate again.
          }
        }
      }
      setPhase("authenticated");
      setPassword("");
    } catch {
      setError({ message: "שגיאת רשת", code: "network", step: "login" });
      setSubmitting(false);
    }
  }, [username, password, submitting]);

  if (phase === "probing") {
    return (
      <div className="login-screen" dir="rtl" lang="he" aria-busy="true">
        <div className="login-screen__backdrop" aria-hidden="true" />
      </div>
    );
  }

  if (phase === "authenticated") return <>{children}</>;

  return (
    <div
      className="login-screen"
      dir="rtl"
      lang="he"
      role="dialog"
      aria-modal="true"
      aria-labelledby="editor-login-title"
    >
      <div className="login-screen__backdrop" aria-hidden="true" />
      <div className="login-card">
        <div className="login-card__brand" aria-hidden="true">
          <span className="login-card__brand-mark">WV1</span>
        </div>
        <h1 className="login-card__title" id="editor-login-title">
          כניסת עורך
        </h1>
        <p className="login-card__subtitle">
          הזינו את סיסמת העורך כדי להיכנס לסטודיו של WeatherV1.
        </p>

        <form
          className="login-card__form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
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
              disabled
              aria-readonly="true"
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
                  setError(null);
                }}
                placeholder="••••••••"
                disabled={submitting}
                aria-required="true"
                autoFocus
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

          {error && (
            <div className="login-card__error-host">
              <ErrorBanner error={error} compact onDismiss={() => setError(null)} />
            </div>
          )}

          <button
            type="submit"
            className="btn btn--primary login-card__submit"
            disabled={submitting || !password}
          >
            {submitting ? "מתחבר…" : "התחברות"}
          </button>
        </form>
      </div>
    </div>
  );
}
