"use client";

import { useCallback, useEffect, useState } from "react";
import type { UiError } from "@/shared/errors";
import { uiErrorToClipboard } from "@/shared/errors";
import { stepLabelHe } from "@/client/lib/step-labels";

interface ErrorBannerProps {
  error: UiError;
  onDismiss?: () => void;
  onRetry?: () => void;
  /** Compact variant used inside collapsibles / rows. */
  compact?: boolean;
  /** Hide the metadata chip row (used for very tight contexts). */
  hideChips?: boolean;
}

export function ErrorBanner({
  error,
  onDismiss,
  onRetry,
  compact = false,
  hideChips = false,
}: ErrorBannerProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);

  const handleCopy = useCallback(async () => {
    const payload = uiErrorToClipboard(error);
    try {
      await navigator.clipboard.writeText(payload);
      setCopied(true);
    } catch {
      // Older browsers / Electron contexts without permission: fall back to
      // a textarea hack so "Copy" never silently fails on the user.
      const ta = document.createElement("textarea");
      ta.value = payload;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        /* give up */
      }
      document.body.removeChild(ta);
    }
  }, [error]);

  const step = stepLabelHe(error.step);
  const cls = ["error-banner", compact ? "error-banner--compact" : ""]
    .filter(Boolean)
    .join(" ");

  return (
    <div className={cls} role="alert" data-error-code={error.code ?? undefined}>
      <div className="error-banner__row">
        <span className="error-banner__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18">
            <circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" strokeWidth="2" />
            <path d="M12 7v6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="16.5" r="1" fill="currentColor" />
          </svg>
        </span>
        <div className="error-banner__body">
          <div className="error-banner__message">{error.message}</div>
          {!hideChips && (error.code || step || error.provider) && (
            <div className="error-banner__chips">
              {step && <span className="error-banner__chip">{step}</span>}
              {error.code && (
                <span className="error-banner__chip error-banner__chip--code" dir="ltr">
                  {error.code}
                </span>
              )}
              {error.provider && (
                <span className="error-banner__chip" dir="ltr">
                  {error.provider}
                </span>
              )}
            </div>
          )}
          {error.details && !compact && (
            <details className="error-banner__details">
              <summary>הצג פרטים</summary>
              <pre dir="ltr">{error.details}</pre>
            </details>
          )}
        </div>
        <div className="error-banner__actions">
          {error.consoleUrl && (
            <a
              className="error-banner__action error-banner__action--link"
              href={error.consoleUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              פתח קונסולה
            </a>
          )}
          {onRetry && (
            <button
              type="button"
              className="error-banner__action"
              onClick={onRetry}
            >
              נסה שוב
            </button>
          )}
          <button
            type="button"
            className="error-banner__action"
            onClick={handleCopy}
            aria-label="העתק שגיאה"
          >
            {copied ? "הועתק" : "העתק"}
          </button>
          {onDismiss && (
            <button
              type="button"
              className="error-banner__action error-banner__dismiss"
              onClick={onDismiss}
              aria-label="סגור"
            >
              ×
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
