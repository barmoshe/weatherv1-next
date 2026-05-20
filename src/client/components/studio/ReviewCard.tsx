"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { StudioPhase, TileState } from "./StudioPanel";
import { formatTime } from "@/client/lib/format-time";
import { toUiError, type UiError } from "@/shared/errors";

interface Segment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptData {
  job_id: string;
  transcript: string;
  duration: number;
  filename: string;
  segments: Array<Segment>;
}

interface ReviewCardProps {
  jobId: string | null;
  transcriptData: TranscriptData | null;
  tileState: TileState;
  phase: StudioPhase;
  onTranscriptChange: (next: string) => void;
  onConfirm: () => void;
  onError: (err: UiError) => void;
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
  phase,
  onTranscriptChange,
  onConfirm,
  onError,
}: ReviewCardProps) {
  const baseline = transcriptData?.transcript ?? "";
  const segments = transcriptData?.segments ?? [];
  const hasSegments = segments.length > 0;

  const [drafts, setDrafts] = useState<string[]>(() => segments.map((s) => s.text));
  const [fallbackDraft, setFallbackDraft] = useState(baseline);
  const [saving, setSaving] = useState(false);
  const [playingIdx, setPlayingIdx] = useState<number | null>(null);
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  // null = not yet probed; true/false = known. Probed via HEAD so the play
  // button can render disabled instead of throwing NotSupportedError on click.
  const [audioAvailable, setAudioAvailable] = useState<boolean | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastSyncedJob = useRef<string | null>(null);

  useEffect(() => {
    if (!transcriptData) return;
    if (lastSyncedJob.current === transcriptData.job_id) return;
    lastSyncedJob.current = transcriptData.job_id;
    setFallbackDraft(transcriptData.transcript);
    setDrafts(transcriptData.segments.map((s) => s.text));
    setPlayingIdx(null);
    setActiveIdx(null);
    setAudioAvailable(null);
  }, [transcriptData]);

  const joined = useMemo(() => {
    if (hasSegments) return drafts.map((s) => s.trim()).filter(Boolean).join(" ");
    return fallbackDraft;
  }, [drafts, fallbackDraft, hasSegments]);

  const dirty = useMemo(() => joined.trim() !== baseline.trim(), [joined, baseline]);

  const audioSrc = jobId ? `/api/voiceovers/${jobId}` : null;

  // Probe availability with HEAD so the play buttons can render disabled when
  // the underlying voiceover file is missing (e.g. plan bundle survived but
  // the uploads dir was cleared, or the job was created in a prior workspace).
  useEffect(() => {
    if (!audioSrc) {
      setAudioAvailable(null);
      return;
    }
    let cancelled = false;
    fetch(audioSrc, { method: "HEAD" })
      .then((r) => {
        if (!cancelled) setAudioAvailable(r.ok);
      })
      .catch(() => {
        if (!cancelled) setAudioAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [audioSrc]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !hasSegments) return;
    const onTime = () => {
      if (playingIdx !== null) {
        const seg = segments[playingIdx];
        if (seg && a.currentTime >= seg.end - 0.05) {
          a.pause();
          setPlayingIdx(null);
        }
      }
      const ct = a.currentTime;
      const idx = segments.findIndex((s) => ct >= s.start && ct < s.end);
      setActiveIdx(idx >= 0 ? idx : null);
    };
    const onEnded = () => {
      setPlayingIdx(null);
      setActiveIdx(null);
    };
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("ended", onEnded);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("ended", onEnded);
    };
  }, [playingIdx, segments, hasSegments]);

  function toggleSegment(idx: number) {
    const a = audioRef.current;
    const seg = segments[idx];
    if (!a || !seg) return;
    if (audioAvailable === false) return;
    if (playingIdx === idx && !a.paused) {
      a.pause();
      setPlayingIdx(null);
      return;
    }
    a.currentTime = seg.start;
    a.play().catch(() => {
      // Source 404 / decode failure / autoplay block — surface as a disabled
      // button rather than letting the unhandled rejection bubble to the page.
      setAudioAvailable(false);
      setPlayingIdx(null);
    });
    setPlayingIdx(idx);
  }

  function handleDraftChange(idx: number, value: string) {
    setDrafts((prev) => {
      const next = prev.slice();
      next[idx] = value;
      return next;
    });
  }

  const handleContinue = async () => {
    if (!jobId || !transcriptData) return;
    setSaving(true);
    try {
      if (dirty) {
        // When the user edited per-segment textareas we also have to send the
        // rebuilt segments — the PATCH route persists transcript AND
        // transcript_segments. Without segments, the joined transcript would
        // save but the segmented review reloads from transcript_segments
        // (whisper original) and the edits would look lost.
        const body: { transcript: string; segments?: Segment[] } = { transcript: joined };
        if (hasSegments) {
          body.segments = segments.map((s, idx) => ({
            start: s.start,
            end: s.end,
            text: (drafts[idx] ?? s.text).trim(),
          }));
        }
        const res = await fetch(`/api/transcript/${jobId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const data = (await res.json().catch(() => ({}))) as {
          success?: boolean;
          error?: string;
          transcript?: string;
        };
        if (!res.ok || !data.success) {
          throw new Error(data.error ?? `Save failed (${res.status})`);
        }
        onTranscriptChange(data.transcript ?? joined);
      }
      onConfirm();
    } catch (err) {
      onError(toUiError(err, "שמירת התמלול נכשלה"));
    } finally {
      setSaving(false);
    }
  };

  const isLoadingTranscription =
    tileState === "is-skeleton" ||
    tileState === "waiting" ||
    (phase === "transcribing" && !hasSegments && !baseline);

  if (isLoadingTranscription) {
    const pillLabel = phase === "transcribing" ? "מתמלל" : STATUS_LABELS[tileState];
    return (
      <section
        className={`tile step ${tileState}`}
        id="step-review"
        data-area="review"
        aria-label="תמלול וסקירת הקראה"
      >
        <header className="tile-header">
          <ReviewIcon />
          <span className="step-title">תמלול וסקירת הקראה</span>
          <span className="status-pill">{pillLabel}</span>
        </header>
        <div className="tile-body">
          <div className="step-content scroll-y">
            <div className="skeleton-lines" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </div>
        </div>
      </section>
    );
  }

  const readOnly =
    tileState === "completed" ||
    phase === "planning" ||
    phase === "planned" ||
    phase === "rendering" ||
    phase === "done";
  const segmentCountLabel = hasSegments ? `${segments.length} משפטים` : null;
  const durationLabel = transcriptData?.duration ? formatTime(transcriptData.duration) : null;
  const filenameLabel = transcriptData?.filename ?? null;

  return (
    <section
      className={`tile step ${tileState}`}
      id="step-review"
      data-area="review"
      aria-label="תמלול וסקירת הקראה"
    >
      <header className="tile-header">
        <ReviewIcon />
        <span className="step-title">תמלול וסקירת הקראה</span>
        <span className="status-pill">{saving ? "שומר" : STATUS_LABELS[tileState]}</span>
      </header>
      <div className="tile-body">
        <div className="step-content scroll-y review-body">
          {(filenameLabel || durationLabel || segmentCountLabel || audioAvailable === false) && (
            <div className="review-summary">
              {filenameLabel && <span dir="ltr">{filenameLabel}</span>}
              {durationLabel && <span dir="ltr">{durationLabel}</span>}
              {segmentCountLabel && <span>{segmentCountLabel}</span>}
              {audioAvailable === false && (
                <span className="review-audio-missing" data-testid="review-audio-missing">
                  הקול המקורי אינו זמין · עריכת טקסט בלבד
                </span>
              )}
            </div>
          )}

          {audioSrc && audioAvailable !== false && (
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <audio
              ref={audioRef}
              preload="metadata"
              src={audioSrc}
              data-testid="review-audio"
              style={{ display: "none" }}
              onError={() => setAudioAvailable(false)}
            />
          )}

          {hasSegments ? (
            <div className="review-segments">
              {segments.map((seg, idx) => {
                const isPlaying = playingIdx === idx;
                const isActive = activeIdx === idx;
                const cls = [
                  "review-segment",
                  isPlaying ? "is-playing" : "",
                  isActive ? "is-active" : "",
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  <div key={idx} className={cls}>
                    <button
                      type="button"
                      className="review-segment__play"
                      onClick={() => toggleSegment(idx)}
                      aria-label={
                        audioAvailable === false
                          ? "הקול המקורי אינו זמין"
                          : isPlaying
                            ? "השהה משפט"
                            : "השמע משפט"
                      }
                      title={
                        audioAvailable === false
                          ? "הקול המקורי אינו זמין"
                          : undefined
                      }
                      disabled={audioAvailable === false}
                      data-testid={`review-segment-play-${idx}`}
                    >
                      {isPlaying ? <PauseIcon /> : <PlayIcon />}
                    </button>
                    <span className="review-segment__time" dir="ltr">
                      {formatTime(seg.start)}
                    </span>
                    <textarea
                      className="review-segment__text"
                      value={drafts[idx] ?? ""}
                      onChange={(e) => handleDraftChange(idx, e.target.value)}
                      rows={Math.max(1, Math.ceil((drafts[idx]?.length ?? 0) / 60))}
                      spellCheck={false}
                      readOnly={readOnly || saving}
                      data-testid={`review-segment-text-${idx}`}
                    />
                  </div>
                );
              })}
            </div>
          ) : (
            <>
              <label className="review-label" htmlFor="review-transcript">
                תמלול לעריכה
              </label>
              <textarea
                id="review-transcript"
                className="review-textarea"
                value={fallbackDraft}
                onChange={(e) => setFallbackDraft(e.target.value)}
                rows={10}
                spellCheck={false}
                disabled={saving || readOnly}
                data-testid="review-textarea"
              />
            </>
          )}

          {!readOnly && (
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
          )}
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

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}
