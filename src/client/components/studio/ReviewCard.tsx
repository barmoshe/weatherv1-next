"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { TileState } from "./StudioPanel";

interface TranscriptData {
  job_id: string;
  transcript: string;
  duration: number;
  filename: string;
  segments: Array<{ start: number; end: number; text: string }>;
}

interface ReviewCardProps {
  jobId: string | null;
  transcriptData: TranscriptData | null;
  tileState: TileState;
  onTranscriptChange: (next: string) => void;
  onConfirm: () => void;
  onError: (msg: string) => void;
}

const STATUS_LABELS: Record<TileState, string> = {
  "is-skeleton": "ממתין",
  waiting: "בתור",
  active: "סקירה",
  completed: "הושלם",
  failed: "נכשל",
};

export function ReviewCard({
  jobId,
  transcriptData,
  tileState,
  onTranscriptChange,
  onConfirm,
  onError,
}: ReviewCardProps) {
  const baseline = transcriptData?.transcript ?? "";
  const [draft, setDraft] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const lastSyncedJob = useRef<string | null>(null);

  // Re-seed the textarea when a different job's transcript arrives.
  useEffect(() => {
    if (!transcriptData) return;
    if (lastSyncedJob.current === transcriptData.job_id) return;
    lastSyncedJob.current = transcriptData.job_id;
    setDraft(transcriptData.transcript);
  }, [transcriptData]);

  const dirty = useMemo(() => draft.trim() !== baseline.trim(), [draft, baseline]);

  const audioSrc = jobId ? `/api/voiceovers/${jobId}` : null;

  const handleContinue = async () => {
    if (!jobId || !transcriptData) return;
    setSaving(true);
    try {
      if (dirty) {
        const res = await fetch(`/api/transcript/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript: draft }),
        });
        const data = await res.json().catch(() => ({})) as { success?: boolean; error?: string; transcript?: string };
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? `Save failed (${res.status})`);
        }
        onTranscriptChange(data.transcript ?? draft);
      }
      onConfirm();
    } catch (err) {
      onError(String(err));
    } finally {
      setSaving(false);
    }
  };

  if (tileState === "is-skeleton" || tileState === "waiting") {
    return (
      <section
        className={`tile step ${tileState}`}
        id="step-review"
        data-area="review"
        aria-label="שלב 3 — סקירה והקראה"
      >
        <header className="tile-header">
          <ReviewIcon />
          <span className="step-title">סקירת הקראה</span>
          <span className="status-pill">{STATUS_LABELS[tileState]}</span>
        </header>
        <div className="tile-body">
          <div className="step-content scroll-y">
            <div className="skeleton-lines" aria-hidden="true"><span/><span/><span/></div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`tile step ${tileState}`}
      id="step-review"
      data-area="review"
      aria-label="שלב 3 — סקירה והקראה"
    >
      <header className="tile-header">
        <ReviewIcon />
        <span className="step-title">סקירת הקראה</span>
        <span className="status-pill">{saving ? "שומר" : STATUS_LABELS[tileState]}</span>
      </header>
      <div className="tile-body">
        <div className="step-content scroll-y review-body">
          {audioSrc && (
            <div className="review-audio" dir="ltr">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <audio
                controls
                preload="metadata"
                src={audioSrc}
                data-testid="review-audio"
              />
            </div>
          )}
          <label className="review-label" htmlFor="review-transcript">
            תמלול לעריכה
          </label>
          <textarea
            id="review-transcript"
            className="review-textarea"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            spellCheck={false}
            disabled={saving}
            data-testid="review-textarea"
          />
          <div className="review-actions">
            <span className="review-hint" aria-live="polite">
              {dirty ? "יש שינויים שטרם נשמרו" : "ללא שינויים"}
            </span>
            <button
              type="button"
              className="review-continue-btn"
              onClick={handleContinue}
              disabled={saving || !transcriptData}
              data-testid="review-continue"
            >
              {saving ? "שומר…" : dirty ? "שמור והמשך לציר הזמן" : "המשך לציר הזמן"}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReviewIcon() {
  return (
    <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h12" />
      <path d="M4 12h10" />
      <path d="M4 18h8" />
      <path d="M16 14l4 4" />
      <circle cx="18" cy="12" r="3" />
    </svg>
  );
}
