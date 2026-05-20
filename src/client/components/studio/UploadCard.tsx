"use client";
import { useRef, useState, useCallback } from "react";
import { desktop } from "@/client/lib/desktop";
import { toUiError, type UiError } from "@/shared/errors";
import type { StudioPhase } from "./StudioPanel";

interface UploadCardProps {
  onSuccess: (data: {
    job_id: string;
    transcript: string;
    duration: number;
    filename: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }) => void;
  onError: (err: UiError) => void;
  onPhaseChange: (phase: StudioPhase) => void;
}

export function UploadCard({ onSuccess, onError, onPhaseChange }: UploadCardProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleTranscribeResponse = useCallback(
    async (res: Response, fallbackName: string): Promise<void | UiError> => {
      const data = (await res.json()) as Record<string, unknown> & {
        success?: boolean;
        job_id?: string;
        transcript?: string;
        duration?: number;
        filename?: string;
        segments?: Array<{ start: number; end: number; text: string }>;
      };
      if (!data.success || !data.job_id) {
        return toUiError({ ...data, failed_step: "transcribe" }, "התמלול נכשל");
      }
      onSuccess({
        job_id: data.job_id,
        transcript: data.transcript ?? "",
        duration: data.duration ?? 0,
        filename: data.filename ?? fallbackName,
        segments: data.segments ?? [],
      });
    },
    [onSuccess],
  );

  const processFile = useCallback(
    async (file: File) => {
      if (!file) return;
      setLoading(true);
      onPhaseChange("transcribing");
      try {
        const fd = new FormData();
        fd.append("audio", file);
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        const failure = await handleTranscribeResponse(res, file.name);
        if (failure) {
          onError(failure);
          onPhaseChange("upload");
        }
      } catch (err) {
        onError(toUiError(err, "התמלול נכשל"));
        onPhaseChange("upload");
      } finally {
        setLoading(false);
      }
    },
    [handleTranscribeResponse, onError, onPhaseChange],
  );

  const processDesktopFile = useCallback(async () => {
    if (!desktop) {
      inputRef.current?.click();
      return;
    }

    const picked = await desktop.pickAudioFile();
    if (!picked) return;

    setLoading(true);
    onPhaseChange("transcribing");
    try {
      const res = await fetch("/api/transcribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ desktop_file_path: picked.path }),
      });
      const failure = await handleTranscribeResponse(res, picked.name);
      if (failure) {
        onError(failure);
        onPhaseChange("upload");
      }
    } catch (err) {
      onError(toUiError(err, "התמלול נכשל"));
      onPhaseChange("upload");
    } finally {
      setLoading(false);
    }
  }, [handleTranscribeResponse, onError, onPhaseChange]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) processFile(file);
    },
    [processFile],
  );

  return (
    <section
      className={`card upload-card upload-banner${dragging ? " is-dragover" : ""}`}
      id="drop-zone"
      aria-label="העלאת קובץ אודיו"
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      <div className="mic-chip" aria-hidden="true">
        <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="9" y="3" width="6" height="12" rx="3"/>
          <path d="M5 11a7 7 0 0 0 14 0"/>
          <path d="M12 18v3"/>
          <path d="M9 21h6"/>
        </svg>
      </div>
      <div className="upload-copy">
        <h2>{loading ? "מתמלל…" : "העלאת קריינות"}</h2>
        <p>{loading ? "אנא המתן" : "גרור לכאן קובץ אודיו או לחץ לבחירה"}</p>
      </div>
      <input
        type="file"
        id="file-input"
        accept="audio/*"
        ref={inputRef}
        onChange={handleChange}
      />
      <button
        className="btn upload-cta"
        type="button"
        disabled={loading}
        onClick={processDesktopFile}
      >
        {loading ? "…" : "בחר קובץ"}
      </button>
    </section>
  );
}
