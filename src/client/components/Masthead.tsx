"use client";

import { desktop } from "@/client/lib/desktop";

interface MastheadProps {
  onNewJob: () => void;
  onOpenSettings: () => void;
}

async function handleSignOut() {
  try {
    await fetch("/api/auth/sign-out", { method: "POST" });
  } catch {
    // Best-effort: even if the request fails the reload will re-show
    // the gate, which probes /api/auth/me and falls back to login.
  }
  if (desktop?.clearEditorSession) {
    try {
      await desktop.clearEditorSession();
    } catch {
      // ignore
    }
  }
  window.location.reload();
}

export function Masthead({ onNewJob, onOpenSettings }: MastheadProps) {
  return (
    <header className="masthead">
      <span className="brand-mark" aria-hidden="true">V1</span>
      <button
        className="settings-btn settings-btn--primary"
        type="button"
        id="new-job-btn"
        onClick={onNewJob}
        aria-keyshortcuts="N"
        title="לחיצה N לתחזית חדשה"
      >
        <span className="cta-label">תחזית חדשה</span>
        <svg className="cta-glyph" viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/>
        </svg>
      </button>
      <span className="wordmark">
        מחולל תחזית<span className="sep">·</span>
        <span className="wordmark-sub">וידאו אנכי</span>
      </span>
      <a
        className="builder-credit"
        dir="ltr"
        href="https://barmoshe.github.io/bar-portfolio/"
        target="_blank"
        rel="noreferrer"
        aria-label="Builder: Bar Moshe"
        title="Open Bar Moshe portfolio"
      >
        <span className="builder-credit__label">Builder</span>
        <span className="builder-credit__sep" aria-hidden="true">·</span>
        <strong className="builder-credit__name">Bar Moshe</strong>
      </a>
      <button
        className="settings-btn"
        type="button"
        onClick={() => void handleSignOut()}
        aria-label="יציאה"
        title="יציאה"
      >
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          focusable="false"
          width="16"
          height="16"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
          <polyline points="16 17 21 12 16 7" />
          <line x1="21" y1="12" x2="9" y2="12" />
        </svg>
        <span className="settings-label">יציאה</span>
      </button>
      <button
        className="settings-btn"
        type="button"
        onClick={onOpenSettings}
        aria-haspopup="dialog"
        aria-label="הגדרות"
        title="הגדרות"
      >
        <svg
          className="settings-glyph"
          viewBox="0 0 28 28"
          aria-hidden="true"
          focusable="false"
          width="18"
          height="18"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          overflow="visible"
        >
          <circle cx="14" cy="14" r="3.2" />
          <path d="M14 4.2v2.3M14 21.5v2.3M4.2 14h2.3M21.5 14h2.3M7.05 7.05l1.62 1.62M19.33 19.33l1.62 1.62M7.05 20.95l1.62-1.62M19.33 8.67l1.62-1.62" />
        </svg>
        <span className="settings-label">הגדרות</span>
      </button>
    </header>
  );
}
