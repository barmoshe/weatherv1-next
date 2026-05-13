"use client";

import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJobStatus } from "@/client/hooks/useJobStatus";
import { useR2SyncStatus } from "@/client/hooks/useCatalog";
import { desktop } from "@/client/lib/desktop";
import { UploadCard } from "./UploadCard";
import { TranscribeCard } from "./TranscribeCard";
import { PlanCard } from "./PlanCard";
import { RenderCard } from "./RenderCard";
import { OutputCard } from "./OutputCard";
import { WhyPanel } from "./WhyPanel";
import { HeroStrip } from "./HeroStrip";
import type { DesktopAppInfo } from "@/shared/desktop";
import type { Scene } from "@/shared/types";

export type StudioPhase = "upload" | "transcribing" | "transcribed" | "planning" | "planned" | "rendering" | "done" | "failed";

interface TranscriptData {
  job_id: string;
  transcript: string;
  duration: number;
  filename: string;
  segments: Array<{ start: number; end: number; text: string }>;
}

interface PlanData {
  scenes: Scene[];
  timeline: Record<string, unknown>[];
  validator: Record<string, unknown>;
}

export type TileState = "is-skeleton" | "waiting" | "active" | "completed" | "failed";

function deriveTileStates(phase: StudioPhase): Record<string, TileState> {
  switch (phase) {
    case "upload":
      return { audio: "is-skeleton", plan: "is-skeleton", render: "is-skeleton", output: "is-skeleton", diag: "is-skeleton" };
    case "transcribing":
      return { audio: "active", plan: "waiting", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "transcribed":
      return { audio: "completed", plan: "active", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "planning":
      return { audio: "completed", plan: "active", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "planned":
      return { audio: "completed", plan: "completed", render: "active", output: "waiting", diag: "is-skeleton" };
    case "rendering":
      return { audio: "completed", plan: "completed", render: "active", output: "waiting", diag: "is-skeleton" };
    case "done":
      return { audio: "completed", plan: "completed", render: "completed", output: "completed", diag: "completed" };
    case "failed":
      return { audio: "completed", plan: "completed", render: "failed", output: "is-skeleton", diag: "is-skeleton" };
    default:
      return { audio: "is-skeleton", plan: "is-skeleton", render: "is-skeleton", output: "is-skeleton", diag: "is-skeleton" };
  }
}

interface StudioPanelProps {
  hidden?: boolean;
  restoreJobId?: string | null;
  onJobStarted?: (jobId: string, audioFilename: string, duration: number, createdAt: string, transcriptPreview: string) => void;
  onJobCompleted?: (jobId: string, outputUrl: string) => void;
  onJobIdChange?: (jobId: string | null) => void;
  onJobStatusChange?: (jobId: string, status: string, outputUrl?: string | null) => void;
}

export function StudioPanel({ hidden, restoreJobId, onJobStarted, onJobCompleted, onJobIdChange, onJobStatusChange }: StudioPanelProps) {
  const [phase, setPhase] = useState<StudioPhase>("upload");
  const [error, setError] = useState<string | null>(null);
  const [transcriptData, setTranscriptData] = useState<TranscriptData | null>(null);
  const [planData, setPlanData] = useState<PlanData | null>(null);
  const [appInfo, setAppInfo] = useState<DesktopAppInfo | null>(null);
  const [r2Token, setR2Token] = useState("");
  const [r2TokenSaving, setR2TokenSaving] = useState(false);
  const [r2TokenSaved, setR2TokenSaved] = useState(false);
  const [r2TokenError, setR2TokenError] = useState<string | null>(null);
  const qc = useQueryClient();
  const { data: r2Status, refetch: refetchR2Status } = useR2SyncStatus();

  const jobId = transcriptData?.job_id ?? null;

  useEffect(() => {
    if (!desktop) return;
    let cancelled = false;
    void desktop.getAppInfo().then((info) => {
      if (!cancelled) setAppInfo(info);
    }).catch(() => {
      if (!cancelled) setAppInfo(null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!restoreJobId) {
      // Reset to clean upload state any time the URL job param goes away
      setPhase("upload");
      setTranscriptData(null);
      setPlanData(null);
      setError(null);
      return;
    }
    if (transcriptData?.job_id === restoreJobId) return;

    let cancelled = false;
    (async () => {
      try {
        const [planRes, statusRes] = await Promise.all([
          fetch(`/api/plan/${restoreJobId}`),
          fetch(`/api/status/${restoreJobId}`),
        ]);
        if (cancelled) return;
        if (!planRes.ok) {
          if (planRes.status === 404) {
            onJobStatusChange?.(restoreJobId, "lost");
            setPhase("failed");
            setError(`Job ${restoreJobId.slice(0, 8)} not found`);
            return;
          }
          setError(`Could not restore job ${restoreJobId.slice(0, 8)}`);
          return;
        }
        const planPayload = await planRes.json() as {
          success?: boolean;
          plan?: Record<string, unknown>;
        };
        const plan = (planPayload.plan ?? planPayload) as Record<string, unknown>;
        const timeline = (plan.timeline as Record<string, unknown>[] | undefined) ?? [];
        const scenes = (plan.scenes as Scene[] | undefined) ?? [];
        const validator = (plan.validator as Record<string, unknown> | undefined) ?? {};

        setTranscriptData({
          job_id: restoreJobId,
          transcript: String(plan.transcript ?? ""),
          duration: Number(plan.duration_sec ?? 0),
          filename: String(plan.audio_filename ?? ""),
          segments: (plan.transcript_segments as Array<{ start: number; end: number; text: string }> | undefined) ?? [],
        });

        if (timeline.length > 0) {
          setPlanData({ scenes, timeline, validator });
        } else {
          setPlanData(null);
        }

        let liveStatus: string | null = null;
        let outputUrl: string | null = null;
        if (statusRes.status === 404) {
          liveStatus = "lost";
        } else if (statusRes.ok) {
          const s = await statusRes.json() as { status?: string; output_url?: string | null };
          liveStatus = s.status ?? null;
          outputUrl = s.output_url ?? null;
        }
        if (liveStatus) onJobStatusChange?.(restoreJobId, liveStatus, outputUrl);

        if (liveStatus === "completed") {
          setPhase("done");
          if (outputUrl) onJobCompleted?.(restoreJobId, outputUrl);
        } else if (liveStatus === "failed" || liveStatus === "lost") {
          if (liveStatus === "lost") setError(`Job ${restoreJobId.slice(0, 8)} not found`);
          setPhase("failed");
        } else if (liveStatus === "processing" || liveStatus === "queued") {
          setPhase("rendering");
        } else if (timeline.length > 0) {
          setPhase("planned");
        } else {
          setPhase("transcribed");
        }
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();

    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restoreJobId]);

  // Poll status while any non-terminal phase has an active job (rendering OR restored mid-flight).
  const shouldPoll = !!jobId && (phase === "rendering" || phase === "planned" || phase === "transcribed" || phase === "planning" || phase === "transcribing");
  const { data: jobStatus } = useJobStatus(jobId, shouldPoll);

  useEffect(() => {
    if (!jobStatus || !jobId) return;
    // Mirror every observed status into the parent's localStorage entry so Active/History badges stay live.
    onJobStatusChange?.(jobId, jobStatus.status, jobStatus.output_url ?? null);

    if (jobStatus.status === "completed" && jobStatus.output_url) {
      setPhase("done");
      onJobCompleted?.(jobId, jobStatus.output_url);
    } else if (jobStatus.status === "failed" || jobStatus.status === "lost") {
      setError(jobStatus.error ?? "Render failed");
      setPhase("failed");
    } else if (jobStatus.status === "processing" && phase !== "rendering") {
      setPhase("rendering");
    }
  }, [jobStatus, jobId, onJobCompleted, onJobStatusChange, phase]);

  const handleUploadSuccess = useCallback((data: TranscriptData) => {
    setTranscriptData(data);
    setPhase("transcribed");
    setError(null);
    const preview = (data.transcript ?? "").trim().slice(0, 80);
    onJobStarted?.(data.job_id, data.filename, data.duration, new Date().toISOString(), preview);
    onJobIdChange?.(data.job_id);
  }, [onJobStarted, onJobIdChange]);

  const handlePlanSuccess = useCallback((data: PlanData) => {
    setPlanData(data);
    setPhase("planned");
    setError(null);
  }, []);

  const handleRenderStart = useCallback(async () => {
    if (!transcriptData || !planData) return;
    setPhase("rendering");
    setError(null);
    try {
      const res = await fetch("/api/render", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          job_id: transcriptData.job_id,
          audio_filename: transcriptData.filename,
          timeline: planData.timeline,
          scenes: planData.scenes,
          validator: planData.validator,
        }),
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (!data.success) {
        setError(data.error ?? "Render failed");
        setPhase("planned");
      } else {
        qc.invalidateQueries({ queryKey: ["job-status", transcriptData.job_id] });
      }
    } catch (err) {
      setError(String(err));
      setPhase("planned");
    }
  }, [transcriptData, planData, qc]);

  const handleReplan = useCallback((data: PlanData) => {
    setPlanData(data);
    setError(null);
    if (phase !== "done") setPhase("planned");
  }, [phase]);

  const handleNewJob = useCallback(() => {
    setPhase("upload");
    setTranscriptData(null);
    setPlanData(null);
    setError(null);
    onJobIdChange?.(null);
  }, [onJobIdChange]);

  const saveR2Token = useCallback(async () => {
    if (!desktop || !r2Token.trim()) return;
    setR2TokenSaving(true);
    setR2TokenSaved(false);
    setR2TokenError(null);
    try {
      await desktop.saveSettings({ r2SessionToken: r2Token.trim() });
      setR2Token("");
      setR2TokenSaved(true);
      await refetchR2Status();
    } catch (err) {
      setR2TokenError(err instanceof Error ? err.message : String(err));
    } finally {
      setR2TokenSaving(false);
    }
  }, [r2Token, refetchR2Status]);

  const tileStates = deriveTileStates(phase);
  const showUploadBanner = phase === "upload";
  const showR2TokenPrompt = Boolean(desktop && appInfo?.packaged && r2Status?.enabled && !r2Status.ready);

  const phaseIndex = {
    upload: 0, transcribing: 1, transcribed: 1, planning: 2, planned: 2, rendering: 3, done: 4, failed: 3,
  }[phase];

  return (
    <section
      className="tab-panel"
      id="panel-studio"
      role="tabpanel"
      aria-labelledby="tab-studio"
      data-tab-panel="studio"
      hidden={hidden}
    >
      <div id="error-banner" hidden={!error}>
        {error}
      </div>

      {showR2TokenPrompt && (
        <div className="studio-r2-token-card" role="region" aria-label="Cloudflare R2 app token">
          <div>
            <strong>Cloudflare R2 token required</strong>
            <p>
              Production uses the WeatherV1 R2 catalog. Paste the app token once to connect this desktop app.
            </p>
            {r2Status?.error && <p className="studio-r2-token-card__error">{r2Status.error}</p>}
            {r2TokenError && <p className="studio-r2-token-card__error">{r2TokenError}</p>}
            {r2TokenSaved && <p className="studio-r2-token-card__ok">Saved. Restarting the local server…</p>}
          </div>
          <form
            className="studio-r2-token-form"
            onSubmit={(event) => {
              event.preventDefault();
              void saveR2Token();
            }}
          >
            <input
              type="password"
              value={r2Token}
              onChange={(event) => {
                setR2Token(event.target.value);
                setR2TokenSaved(false);
              }}
              placeholder="Worker app token"
              autoComplete="off"
            />
            <button className="btn btn--primary" type="submit" disabled={r2TokenSaving || !r2Token.trim()}>
              {r2TokenSaving ? "Saving…" : "Connect R2"}
            </button>
          </form>
        </div>
      )}

      <HeroStrip
        jobId={jobId}
        phase={phase}
        phaseIndex={phaseIndex}
        filename={transcriptData?.filename}
        duration={transcriptData?.duration}
      />

      {showUploadBanner && (
        <UploadCard
          onSuccess={handleUploadSuccess}
          onError={setError}
          onPhaseChange={setPhase}
        />
      )}

      <div className={`dash-grid${showUploadBanner ? " is-empty" : ""}`} id="dash-grid">
        <TranscribeCard
          transcriptData={transcriptData}
          phase={phase}
          tileState={tileStates.audio}
        />

        <PlanCard
          jobId={jobId}
          transcriptData={transcriptData}
          planData={planData}
          phase={phase}
          tileState={tileStates.plan}
          onPlanSuccess={handlePlanSuccess}
          onReplan={handleReplan}
          onPhaseChange={setPhase}
          onError={setError}
        />

        <RenderCard
          phase={phase}
          tileState={tileStates.render}
          planData={planData}
          onRenderStart={handleRenderStart}
        />

        <OutputCard
          phase={phase}
          tileState={tileStates.output}
          jobStatus={jobStatus ?? null}
          outputFilename={jobStatus?.output_url ?? null}
        />

        <WhyPanel
          tileState={tileStates.diag}
          hidden={!planData}
          timeline={planData?.timeline ?? []}
          validator={planData?.validator ?? {}}
          scenes={planData?.scenes ?? []}
        />
      </div>
    </section>
  );
}
