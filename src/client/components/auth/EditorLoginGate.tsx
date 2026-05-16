"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";

import { desktop } from "@/client/lib/desktop";

const EDITOR_USERNAME = "v1editor";

type Phase = "probing" | "needs-login" | "authenticated";

interface EditorLoginGateProps {
  children: ReactNode;
}

export function EditorLoginGate({ children }: EditorLoginGateProps) {
  const [phase, setPhase] = useState<Phase>("probing");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const data = (await res.json()) as { ok?: boolean };
        if (cancelled) return;
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
        body: JSON.stringify({ username: EDITOR_USERNAME, password }),
      });
      const data = (await res.json()) as {
        success?: boolean;
        token?: string;
        error?: string;
      };
      if (!data.success || !data.token) {
        setError(data.error || "סיסמה שגויה");
        setSubmitting(false);
        return;
      }
      if (desktop?.setEditorSession) {
        try {
          await desktop.setEditorSession({ token: data.token });
        } catch {
          // Persistence failure is non-fatal — the cookie still
          // authenticates this session. Worst case: relaunch shows the
          // gate again.
        }
      }
      setPhase("authenticated");
      setPassword("");
    } catch {
      setError("שגיאת רשת");
      setSubmitting(false);
    }
  }, [password, submitting]);

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
              value={EDITOR_USERNAME}
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
            <p className="login-card__error" role="alert">
              {error}
            </p>
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
