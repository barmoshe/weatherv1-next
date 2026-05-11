"use client";

interface MastheadProps {
  onNewJob: () => void;
  onOpenSettings: () => void;
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
      <button
        className="settings-btn"
        type="button"
        onClick={onOpenSettings}
        aria-haspopup="dialog"
        aria-label="הגדרות"
        title="הגדרות"
      >
        <svg className="settings-glyph" viewBox="0 0 24 24" aria-hidden="true" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9z"/>
        </svg>
        <span className="settings-label">הגדרות</span>
      </button>
    </header>
  );
}
