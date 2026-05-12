"use client";
import type { StudioPhase } from "./StudioPanel";
import { formatDuration, formatRelativeTime } from "@/client/lib/format-time";
import { useDesktopStatus } from "@/client/hooks/useDesktopStatus";

interface HeroStripProps {
  jobId: string | null;
  phase: StudioPhase;
  phaseIndex: number;
  filename?: string;
  duration?: number;
  createdAt?: string | null;
}

const PHASE_TO_STATUS: Record<StudioPhase, string> = {
  upload: "pending",
  transcribing: "active",
  transcribed: "completed",
  planning: "active",
  planned: "completed",
  rendering: "active",
  done: "completed",
  failed: "failed",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "ממתין להעלאה",
  active: "מעבד",
  completed: "הושלם",
  failed: "נכשל",
  waiting: "בתור",
};

function FileIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
      <path d="M14 3v6h6" />
    </svg>
  );
}
function DurationIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="13" r="7" />
      <path d="M12 9v4l2.5 2.5" />
      <path d="M9 2h6" />
      <path d="M12 2v3" />
    </svg>
  );
}
function ClockIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </svg>
  );
}
function BrainIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M9 4a3 3 0 0 0-3 3v0a3 3 0 0 0-2 5.5A3 3 0 0 0 6 17v0a3 3 0 0 0 3 3h1V4H9z" />
      <path d="M15 4a3 3 0 0 1 3 3v0a3 3 0 0 1 2 5.5A3 3 0 0 1 18 17v0a3 3 0 0 1-3 3h-1V4h1z" />
    </svg>
  );
}
function MicIcon() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

const LLM_LABELS: Record<string, { name: string; tooltip: string }> = {
  anthropic: { name: "Claude", tooltip: "Anthropic Claude" },
  openai: { name: "GPT", tooltip: "OpenAI GPT" },
};

const TRANSCRIPTION_LABELS: Record<string, { name: string; tooltip: string }> = {
  "local-whisper-onnx": { name: "Whisper מקומי", tooltip: "Whisper ONNX running locally (transformers.js)" },
  "openai-cloud": { name: "Whisper ענן", tooltip: "OpenAI Whisper cloud" },
};

function shortModelName(model: string | null): string | null {
  if (!model) return null;
  // claude-sonnet-4-6 → Sonnet 4.6 ; gpt-4o → 4o
  const m = model.toLowerCase();
  if (m.startsWith("claude-")) {
    const rest = m.slice("claude-".length);
    const parts = rest.split("-");
    const family = parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : "";
    const ver = parts.slice(1).join(".");
    return ver ? `${family} ${ver}` : family;
  }
  if (m.startsWith("gpt-")) return m.slice("gpt-".length);
  return model;
}

export function HeroStrip({ jobId, phase, phaseIndex, filename, duration, createdAt }: HeroStripProps) {
  const status = PHASE_TO_STATUS[phase];
  const label = STATUS_LABELS[status] ?? "—";

  const { data: desktopStatus } = useDesktopStatus();
  const llmActive = desktopStatus?.providers.llm_active ?? null;
  const llmLabel = llmActive ? LLM_LABELS[llmActive] : null;
  const llmModelShort = shortModelName(desktopStatus?.providers.llm_model ?? null);
  const txActive = desktopStatus?.providers.transcription_active ?? null;
  const txLabel = txActive ? TRANSCRIPTION_LABELS[txActive] : null;
  const whisperModel = desktopStatus?.whisper.active_model ?? null;

  return (
    <header className="dash-hero" id="dash-hero" aria-label="פרטי ההפקה">
      <div className="hero-meta">
        <span className="hero-title">סטודיו</span>
        <span className="hero-jobid" id="hero-jobid" dir="ltr">
          {jobId ? `#${jobId.slice(0, 8)}` : ""}
        </span>
        <span className={`hero-status-pill is-${status}`} id="hero-status">
          {label}
        </span>
        {llmLabel ? (
          <span
            className={`hero-model-pill is-llm is-${llmActive}`}
            title={llmLabel.tooltip + (llmModelShort ? ` · ${desktopStatus?.providers.llm_model}` : "")}
            data-testid="hero-pill-llm"
          >
            <BrainIcon />
            <span className="hero-model-pill__provider">{llmLabel.name}</span>
            {llmModelShort && (
              <span className="hero-model-pill__model" dir="ltr">
                {llmModelShort}
              </span>
            )}
          </span>
        ) : null}
        {txLabel ? (
          <span
            className={`hero-model-pill is-tx is-${txActive}`}
            title={txLabel.tooltip + (whisperModel && txActive === "local-whisper-onnx" ? ` · ${whisperModel}` : "")}
            data-testid="hero-pill-transcription"
          >
            <MicIcon />
            <span className="hero-model-pill__provider">{txLabel.name}</span>
            {txActive === "local-whisper-onnx" && whisperModel && (
              <span className="hero-model-pill__model" dir="ltr">
                {whisperModel}
              </span>
            )}
          </span>
        ) : null}
      </div>
      <div className="hero-stats">
        <span id="hero-filename" className="hero-stat">
          {filename && (<><FileIcon />{filename}</>)}
        </span>
        <span id="hero-duration" className="hero-stat">
          {duration ? (<><DurationIcon />{formatDuration(duration)}</>) : null}
        </span>
        <span id="hero-created" className="hero-stat">
          {createdAt && (<><ClockIcon />{formatRelativeTime(createdAt)}</>)}
        </span>
      </div>
      <div
        className="seg-bar"
        id="seg-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={4}
        aria-valuenow={phaseIndex}
        aria-label="התקדמות הפקה"
      >
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`seg${phaseIndex > i ? " done" : phaseIndex === i && phase !== "upload" ? " active" : ""}`}>
            <span className="fill" />
          </div>
        ))}
      </div>
    </header>
  );
}

