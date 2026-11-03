"use client";

import { useCallback, useEffect, useState } from "react";
import type { WhisperModelBrief } from "@/client/hooks/useDesktopStatus";
import { StatusDot } from "./settingsShared";
import type { DotVariant } from "./settingsTypes";

// The local Hebrew transcription model: shows whether it is on this machine,
// starts the one-time download and polls `/api/whisper` for progress until it
// is ready. Transcription runs on the editor's computer, so this replaces the
// old "OpenAI key required" note.

const POLL_MS = 1000;

function gb(bytes: number): string {
  return (bytes / 1024 ** 3).toFixed(1);
}

export function WhisperModelCard({ initial }: { initial?: WhisperModelBrief }) {
  const [status, setStatus] = useState<WhisperModelBrief | null>(initial ?? null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/whisper");
    if (res.ok) setStatus((await res.json()) as WhisperModelBrief);
  }, []);

  useEffect(() => {
    if (!status) void refresh();
  }, [status, refresh]);

  useEffect(() => {
    if (status?.state !== "downloading") return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [status?.state, refresh]);

  const startDownload = useCallback(async () => {
    const res = await fetch("/api/whisper", { method: "POST" });
    if (res.ok) setStatus((await res.json()) as WhisperModelBrief);
  }, []);

  if (!status) return null;

  const pct = status.bytes_total ? Math.floor((status.bytes_done / status.bytes_total) * 100) : 0;
  const variant: DotVariant = !status.binary_found
    ? "danger"
    : status.state === "ready"
      ? "ok"
      : status.state === "error"
        ? "danger"
        : "warn";

  return (
    <div className="settings-field">
      <div className="settings-section-header">
        <h4>תמלול בעברית</h4>
        <StatusDot variant={variant} />
      </div>
      {!status.binary_found ? (
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          רכיב התמלול חסר בהתקנה. התקן מחדש את WeatherV1.
        </p>
      ) : status.state === "ready" ? (
        <p className="settings-hint" style={{ marginInlineStart: 0 }}>
          המודל מותקן. התמלול רץ על המחשב הזה, בלי מפתח ובלי עלות.
        </p>
      ) : status.state === "downloading" ? (
        <div className="upload-progress" aria-live="polite">
          <div className="upload-progress-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <span style={{ width: `${pct}%` }} />
          </div>
          <span className="upload-progress-text" dir="ltr">
            {gb(status.bytes_done)} / {gb(status.bytes_total)} GB
          </span>
        </div>
      ) : (
        <>
          <p className="settings-hint" style={{ marginInlineStart: 0 }}>
            {status.state === "error"
              ? `ההורדה נכשלה: ${status.error ?? ""}`
              : `התמלול רץ על המחשב הזה. צריך להוריד פעם אחת את מודל העברית (${gb(status.bytes_total)}GB).`}
          </p>
          <button type="button" className="btn btn--ghost" onClick={() => void startDownload()}>
            {status.state === "error" ? "נסה שוב" : "הורדת המודל"}
          </button>
        </>
      )}
    </div>
  );
}
