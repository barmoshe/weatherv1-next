"use client";
import type { TileState } from "./StudioPanel";

interface TranscriptData {
  transcript: string;
  duration: number;
  filename: string;
}

interface TranscribeCardProps {
  transcriptData: TranscriptData | null;
  phase: string;
  tileState: TileState;
}

const STATUS_LABELS: Record<TileState, string> = {
  "is-skeleton": "ממתין",
  waiting: "בתור",
  active: "מעבד",
  completed: "הושלם",
  failed: "נכשל",
};

export function TranscribeCard({ transcriptData, phase, tileState }: TranscribeCardProps) {
  return (
    <section
      className={`tile step ${tileState}`}
      id="step-transcribe"
      data-area="audio"
      data-expanded="false"
      aria-label="שלב 1 — תמלול"
    >
      <header className="tile-header">
        <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="12" rx="3"/>
          <path d="M5 11a7 7 0 0 0 14 0"/>
          <path d="M12 18v3"/>
          <path d="M9 21h6"/>
        </svg>
        <span className="step-title">תמלול</span>
        <span className="status-pill">{STATUS_LABELS[tileState]}</span>
      </header>
      <div className="tile-body">
        <div className="step-content scroll-y" id="transcribe-result">
          {tileState === "active" && (
            <div className="skeleton-lines" aria-hidden="true"><span/><span/><span/><span/></div>
          )}
          {transcriptData && tileState === "completed" && (
            <p className="transcript-text">{transcriptData.transcript}</p>
          )}
          {tileState === "is-skeleton" && (
            <div className="skeleton-lines" aria-hidden="true"><span/><span/><span/><span/></div>
          )}
        </div>
      </div>
    </section>
  );
}
