"use client";

import { useState, useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useJobStatus } from "@/client/hooks/useJobStatus";
import { UploadCard } from "./UploadCard";
import { TranscribeCard } from "./TranscribeCard";
import { ReviewCard } from "./ReviewCard";
import { PlanCard } from "./PlanCard";
import { RenderCard } from "./RenderCard";
import { OutputCard } from "./OutputCard";
import { WhyPanel } from "./WhyPanel";
import { HeroStrip } from "./HeroStrip";
import type { Scene } from "@/shared/types";

export type StudioPhase = "upload" | "transcribing" | "transcribed" | "reviewing" | "planning" | "planned" | "rendering" | "done" | "failed";

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
      return { audio: "is-skeleton", review: "is-skeleton", plan: "is-skeleton", render: "is-skeleton", output: "is-skeleton", diag: "is-skeleton" };
    case "transcribing":
      return { audio: "active", review: "waiting", plan: "waiting", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "transcribed":
      return { audio: "completed", review: "active", plan: "waiting", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "reviewing":
      return { audio: "completed", review: "active", plan: "waiting", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "planning":
      return { audio: "completed", review: "completed", plan: "active", render: "waiting", output: "waiting", diag: "is-skeleton" };
    case "planned":
      return { audio: "completed", review: "completed", plan: "completed", render: "active", output: "waiting", diag: "is-skeleton" };
    case "rendering":
      return { audio: "completed", review: "completed", plan: "completed", render: "active", output: "waiting", diag: "is-skeleton" };
    case "done":
      return { audio: "completed", review: "completed", plan: "completed", render: "completed", output: "completed", diag: "completed" };
    case "failed":
      return { audio: "completed", review: "completed", plan: "completed", render: "failed", output: "is-skeleton", diag: "is-skeleton" };
    default:
      return { audio: "is-skeleton", review: "is-skeleton", plan: "is-skeleton", render: "is-skeleton", output: "is-skeleton", diag: "is-skeleton" };
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
  const qc = useQueryClient();

  const jobId = transcriptData?.job_id ?? null;

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
            setPhase("failed");
            let detail = `Job ${restoreJobId.slice(0, 8)} not found`;
            try {
              const body = (await planRes.json()) as { error?: string };
              if (body.error === "Plan not found") {
                detail =
                  `Plan bundle missing for job ${restoreJobId.slice(0, 8)} — metadata synced but plan file was never uploaded to R2. From the Mac that still has outputs/, run scripts/backfill-r2-plan-bundles.ts (or touch/save the job once after updating).`;
              }
            } catch {
              /* ignore malformed JSON */
            }
            setError(detail);
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
          setPhase("reviewing");
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
  const shouldPoll = !!jobId && (phase === "rendering" || phase === "planned" || phase === "transcribed" || phase === "reviewing" || phase === "planning" || phase === "transcribing");
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
    setPhase("reviewing");
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

  const handleReviewTranscriptChange = useCallback((nextTranscript: string) => {
    setTranscriptData((prev) => (prev ? { ...prev, transcript: nextTranscript } : prev));
  }, []);

  const handleReviewConfirm = useCallback(() => {
    setError(null);
    setPhase("planning");
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

  const tileStates = deriveTileStates(phase);
  const showUploadBanner = phase === "upload";

  const phaseIndex = {
    upload: 0, transcribing: 1, transcribed: 2, reviewing: 2, planning: 3, planned: 3, rendering: 4, done: 5, failed: 4,
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

        <ReviewCard
          jobId={jobId}
          transcriptData={transcriptData}
          tileState={tileStates.review}
          onTranscriptChange={handleReviewTranscriptChange}
          onConfirm={handleReviewConfirm}
          onError={setError}
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
