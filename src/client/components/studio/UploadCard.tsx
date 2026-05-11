"use client";
import { useRef, useState, useCallback } from "react";
import type { StudioPhase } from "./StudioPanel";

interface UploadCardProps {
  onSuccess: (data: {
    job_id: string;
    transcript: string;
    duration: number;
    filename: string;
    segments: Array<{ start: number; end: number; text: string }>;
  }) => void;
  onError: (msg: string) => void;
  onPhaseChange: (phase: StudioPhase) => void;
}

export function UploadCard({ onSuccess, onError, onPhaseChange }: UploadCardProps) {
  const [dragging, setDragging] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback(
    async (file: File) => {
      if (!file) return;
      setLoading(true);
      onPhaseChange("transcribing");
      try {
        const fd = new FormData();
        fd.append("audio", file);
        const res = await fetch("/api/transcribe", { method: "POST", body: fd });
        const data = await res.json() as {
          success: boolean;
          error?: string;
          job_id?: string;
          transcript?: string;
          duration?: number;
          filename?: string;
          segments?: Array<{ start: number; end: number; text: string }>;
        };
        if (!data.success || !data.job_id) {
          throw new Error(data.error ?? "Transcription failed");
        }
        onSuccess({
          job_id: data.job_id,
          transcript: data.transcript ?? "",
          duration: data.duration ?? 0,
          filename: data.filename ?? file.name,
          segments: data.segments ?? [],
        });
      } catch (err) {
        onError(String(err));
        onPhaseChange("upload");
      } finally {
        setLoading(false);
      }
    },
    [onSuccess, onError, onPhaseChange],
  );

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
        onClick={() => inputRef.current?.click()}
      >
        {loading ? "…" : "בחר קובץ"}
      </button>
    </section>
  );
}
