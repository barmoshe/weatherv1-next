"use client";

import { useCallback, useState } from "react";

interface AdminPasswordPromptProps {
  onUnlocked: () => void;
}

export function AdminPasswordPrompt({ onUnlocked }: AdminPasswordPromptProps) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (submitting || !password) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await res.json()) as { ok?: boolean };
      if (data.ok) {
        setPassword("");
        onUnlocked();
        return;
      }
      setError("סיסמה שגויה");
      setSubmitting(false);
    } catch {
      setError("שגיאת רשת");
      setSubmitting(false);
    }
  }, [password, submitting, onUnlocked]);

  return (
    <div className="settings-section" dir="rtl">
      <header className="settings-section-header">
        <h3>ניהול נעול</h3>
      </header>
      <p className="settings-hint">
        כניסה לטאב הניהול דורשת סיסמת מנהל. הסיסמה תידרש שוב בכל פתיחה של חלון
        ההגדרות.
      </p>
      {/*
        Intentionally NOT a <form>: this component is rendered inside
        the SettingsModal's outer <form>. Nested forms are illegal
        HTML — the browser flattens them, so a type="submit" button
        here would bubble up and trigger saveDesktopSettings (which
        writes settings, R2-syncs, and restarts the child server).
        Instead we use type="button" + an Enter-key handler on the
        input so the UX stays form-like without the side effect.
      */}
      <div className="login-card__form">
        <label className="login-field">
          <span className="login-field__label">סיסמת מנהל</span>
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
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  event.stopPropagation();
                  void handleSubmit();
                }
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
          type="button"
          className="btn btn--primary login-card__submit"
          disabled={submitting || !password}
          onClick={() => void handleSubmit()}
        >
          {submitting ? "מאמת…" : "פתח"}
        </button>
      </div>
    </div>
  );
}
