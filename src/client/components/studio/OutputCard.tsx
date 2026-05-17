"use client";
import type { TileState } from "./StudioPanel";
import type { JobStatus } from "@/client/hooks/useJobStatus";
import { STATUS_LABELS } from "./status-labels";

interface OutputCardProps {
  phase: string;
  tileState: TileState;
  jobStatus: JobStatus | null;
  outputFilename: string | null;
}

export function OutputCard({ phase, tileState, jobStatus, outputFilename }: OutputCardProps) {
  const isDone = phase === "done" && !!outputFilename;
  const isRendering = phase === "rendering";
  const fileBase = outputFilename ? outputFilename.split("/").pop() ?? outputFilename : null;

  return (
    <section
      className={`tile tile--output step ${tileState}`}
      id="step-output"
      data-area="output"
      data-waits-for="הרינדור"
      data-expanded="false"
      aria-label="שלב 6 — וידאו סופי"
    >
      <header className="tile-header">
        <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="2" width="12" height="20" rx="2.5" />
          <path d="M11 18h2" />
        </svg>
        <span className="step-title">וידאו סופי</span>
        <span className="status-pill">{STATUS_LABELS[tileState]}</span>
      </header>
      <div className="tile-body">
        <div className="waiting-state" aria-hidden="true">
          <div className="waiting-glyph">
            <svg className="icon" viewBox="0 0 24 24">
              <rect x="6" y="2" width="12" height="20" rx="2.5" />
              <path d="M11 18h2" />
            </svg>
          </div>
          <span className="waiting-badge">
            <svg className="icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3 2" />
            </svg>
            ממתין ל<span className="waiting-label-text"></span>
          </span>
          <div className="waiting-track"></div>
        </div>
        <div className="step-content">
          <div id="video-container">
            {isDone && outputFilename ? (
              <div className="output-success">
                <span className="tally-pill">מוכן לצפייה</span>
                <div className="phone-frame">
                  <video controls playsInline preload="metadata">
                    <source src={`/api/outputs/${outputFilename}`} type="video/mp4" />
                    הדפדפן אינו תומך בנגן וידאו.
                  </video>
                </div>
                {fileBase && (
                  <div className="output-meta" dir="ltr" title={fileBase}>
                    {fileBase}
                  </div>
                )}
                <div className="output-actions">
                  <a
                    className="download-link"
                    href={`/api/outputs/${outputFilename}`}
                    download={outputFilename}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12" />
                      <path d="M6 11l6 6 6-6" />
                      <path d="M5 21h14" />
                    </svg>
                    הורדת הוידאו
                  </a>
                </div>
              </div>
            ) : isRendering ? (
              <div className="phone-frame phone-frame--ghost" aria-hidden="true">
                <div className="skeleton-block" />
                <span className="output-rendering-label">מרנדר…</span>
              </div>
            ) : (
              <div className="phone-frame phone-frame--ghost" aria-hidden="true">
                <div className="skeleton-block" />
              </div>
            )}
          </div>
        </div>
      </div>
      {/* keep prop in TS surface; reserved for future per-status messaging */}
      {jobStatus ? null : null}
    </section>
  );
}
