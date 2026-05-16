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
      <form
        className="login-card__form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
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
          {submitting ? "מאמת…" : "פתח"}
        </button>
      </form>
    </div>
  );
}
