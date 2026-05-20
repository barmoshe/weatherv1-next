"use client";

import { useState, useCallback, useEffect, useRef, Suspense } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useTabFromUrl, useJobFromUrl, useUrlParams } from "@/client/hooks/useTabFromUrl";
import {
  ACTIVE_JOB_STATUSES,
  useLocalHistory,
  type HistoryEntry,
} from "@/client/hooks/useLocalHistory";
import { Masthead } from "@/client/components/Masthead";
import { TabNav } from "@/client/components/TabNav";
import { StudioPanel } from "@/client/components/studio/StudioPanel";
import { SettingsModal } from "@/client/components/studio/SettingsModal";
import { StorageOnboardingGate } from "@/client/components/storage/StorageOnboardingGate";
import { EditorLoginGate } from "@/client/components/auth/EditorLoginGate";
import { DesktopR2BootstrapOverlay } from "@/client/components/storage/DesktopR2BootstrapOverlay";
import { JobsPanel } from "@/client/components/jobs/JobsPanel";
import { AnalyticsPanel } from "@/client/components/jobs/AnalyticsPanel";

const qc = new QueryClient();

function AppInner() {
  const [tab, setTab] = useTabFromUrl();
  const [urlJobId, setUrlJobId] = useJobFromUrl();
  const updateUrl = useUrlParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { history, addEntry, updateEntry, removeEntry, cancelJob, syncFromServer } = useLocalHistory();
  const queryClient = useQueryClient();

  const handleRetryRender = useCallback(
    async (jobId: string) => {
      const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/retry`, {
        method: "POST",
      });
      const data = (await res.json()) as Record<string, unknown>;
      if (!data.success) {
        throw new Error((data.error as string) ?? `HTTP ${res.status}`);
      }
      // Planning-step failures can't be re-queued for render — the route tells
      // us to re-run planning, so send the user back to the studio for the job.
      if (data.resume === "plan") {
        updateUrl({ tab: "studio", job: jobId });
        return;
      }
      updateEntry(jobId, { status: "queued", error: undefined, failed_step: undefined });
      queryClient.invalidateQueries({ queryKey: ["job-status", jobId] });
    },
    [queryClient, updateEntry, updateUrl],
  );

  const handleRestore = useCallback(
    (entry: HistoryEntry) => {
      updateUrl({ tab: "studio", job: entry.job_id });
    },
    [updateUrl],
  );

  const handleNewJob = useCallback(() => {
    updateUrl({ tab: "studio", job: null });
  }, [updateUrl]);

  const handleJobStarted = useCallback(
    (jobId: string, audioFilename: string, duration: number, createdAt: string, transcriptPreview: string) => {
      addEntry({
        job_id: jobId,
        status: "draft",
        audio_filename: audioFilename,
        duration_sec: duration,
        created_at: createdAt,
        transcript_preview: transcriptPreview,
      });
      void syncFromServer();
    },
    [addEntry, syncFromServer],
  );

  const handleJobCompleted = useCallback(
    (jobId: string, outputUrl: string) => {
      updateEntry(jobId, { status: "completed", output_url: outputUrl });
      void syncFromServer();
    },
    [updateEntry, syncFromServer],
  );

  const handleJobStatusChange = useCallback(
    (jobId: string, status: string, outputUrl?: string | null) => {
      const patch: Partial<HistoryEntry> = { status };
      if (outputUrl) patch.output_url = outputUrl;
      updateEntry(jobId, patch);
    },
    [updateEntry],
  );

  // "N" keyboard shortcut for new job — match Flask: skip when modal open, input focused, or modifier held.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "n" && e.key !== "N") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (settingsOpen) return;
      const ae = document.activeElement as HTMLElement | null;
      if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" || ae.isContentEditable)) return;
      e.preventDefault();
      handleNewJob();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen, handleNewJob]);

  // Completion toast: fire when a job we were tracking flips to "completed".
  const [toast, setToast] = useState<string | null>(null);
  const prevStatuses = useRef<Map<string, string>>(new Map());
  useEffect(() => {
    const prev = prevStatuses.current;
    const next = new Map<string, string>();
    for (const j of history) {
      const before = prev.get(j.job_id);
      if (before && before !== "completed" && j.status === "completed") {
        setToast(`הרינדור הושלם · ${j.transcript_preview || j.job_id}`);
      }
      next.set(j.job_id, j.status);
    }
    prevStatuses.current = next; // rebuild so departed jobs don't accumulate
  }, [history]);
  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 5000);
    return () => window.clearTimeout(id);
  }, [toast]);

  const activeCount = history.filter((j) => ACTIVE_JOB_STATUSES.has(j.status)).length;

  return (
    <>
      <Masthead onNewJob={handleNewJob} onOpenSettings={() => setSettingsOpen(true)} />
      <TabNav
        activeTab={tab}
        onTabChange={setTab}
        jobsBadge={activeCount}
      />
      <main className="container">
        <DesktopR2BootstrapOverlay />
        <StorageOnboardingGate />
        <StudioPanel
          hidden={tab !== "studio"}
          restoreJobId={urlJobId}
          jobs={history}
          onJobStarted={handleJobStarted}
          onJobCompleted={handleJobCompleted}
          onJobIdChange={setUrlJobId}
          onJobStatusChange={handleJobStatusChange}
          onRetryRender={handleRetryRender}
        />
        <JobsPanel hidden={tab !== "jobs"} jobs={history} onRestore={handleRestore} onRemove={removeEntry} onCancel={cancelJob} onRetryRender={handleRetryRender} />
        <AnalyticsPanel hidden={tab !== "analytics"} jobs={history} />
        {tab === "catalog" ? (
          <Suspense fallback={<div className="loading">טוען קטלוג…</div>}>
            <CatalogTab />
          </Suspense>
        ) : (
          <CatalogPanelPlaceholder />
        )}
      </main>
      <SettingsModal
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
      {toast && (
        <div className="job-toast" role="status" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </>
  );
}

function CatalogPanelPlaceholder() {
  return (
    <section
      className="tab-panel"
      id="panel-catalog"
      role="tabpanel"
      aria-labelledby="tab-catalog"
      data-tab-panel="catalog"
      hidden
    >
      <header className="catalog-bar">
        <div className="catalog-bar-left">
          <h2 className="catalog-title">קטלוג קליפים</h2>
          <span className="catalog-progress" id="catalog-progress">טוען…</span>
        </div>
        <div className="catalog-bar-right">
          <input type="search" id="catalog-search" className="catalog-search" placeholder="חפש בקטלוג…" aria-label="חיפוש" />
          <select id="catalog-sort" className="catalog-sort" aria-label="מיון">
            <optgroup label="זמן">
              <option value="newest">נוסף לאחרונה</option>
              <option value="oldest">נוסף ראשון</option>
            </optgroup>
          </select>
          <button type="button" className="btn" id="add-video-btn">העלה וידאו</button>
        </div>
      </header>
      <div className="catalog-layout">
        <aside className="catalog-filters" id="catalog-filters" aria-label="מסננים" />
        <div className="catalog-main">
          <div className="catalog-grid" id="catalog-grid">
            <div className="catalog-loading">טוען קטלוג…</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function CatalogTab() {
  const { CatalogPanel } = require("@/client/components/catalog/CatalogPanel") as {
    CatalogPanel: React.ComponentType;
  };
  return <CatalogPanel />;
}

export default function Home() {
  return (
    <QueryClientProvider client={qc}>
      <Suspense>
        <EditorLoginGate>
          <AppInner />
        </EditorLoginGate>
      </Suspense>
    </QueryClientProvider>
  );
}
