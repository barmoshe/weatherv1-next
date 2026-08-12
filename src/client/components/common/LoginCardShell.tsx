"use client";

import type { ReactNode } from "react";

/**
 * Shared chrome for the full-screen login-style overlays (editor login,
 * cloud reconnect, local-library setup). Keeps the dialog a11y wiring —
 * aria-labelledby must match the title id — in one place.
 */
export function LoginCardShell({
  titleId,
  title,
  footer,
  children,
}: {
  titleId: string;
  title: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className="login-screen"
      dir="rtl"
      lang="he"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      <div className="login-screen__backdrop" aria-hidden="true" />
      <div className="login-card">
        <div className="login-card__brand" aria-hidden="true">
          <span className="login-card__brand-mark">WV1</span>
        </div>
        <h1 className="login-card__title" id={titleId}>
          {title}
        </h1>
        {children}
        {footer ? <footer className="login-card__footer">{footer}</footer> : null}
      </div>
    </div>
  );
}
