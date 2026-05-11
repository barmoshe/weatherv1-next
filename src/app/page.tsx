"use client";

import { useState, useCallback, useEffect, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useTabFromUrl, useJobFromUrl, useUrlParams } from "@/client/hooks/useTabFromUrl";
import { useLocalHistory, type HistoryEntry } from "@/client/hooks/useLocalHistory";
import { Masthead } from "@/client/components/Masthead";
import { TabNav } from "@/client/components/TabNav";
import { StudioPanel } from "@/client/components/studio/StudioPanel";
import { SettingsModal } from "@/client/components/studio/SettingsModal";
import { ActivePanel } from "@/client/components/jobs/ActivePanel";
import { HistoryPanel } from "@/client/components/jobs/HistoryPanel";

const qc = new QueryClient();

function AppInner() {
  const [tab, setTab] = useTabFromUrl();
  const [urlJobId, setUrlJobId] = useJobFromUrl();
  const updateUrl = useUrlParams();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const { history, addEntry, updateEntry, removeEntry } = useLocalHistory();

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
    },
    [addEntry],
  );

  const handleJobCompleted = useCallback(
    (jobId: string, outputUrl: string) => {
      updateEntry(jobId, { status: "completed", output_url: outputUrl });
    },
    [updateEntry],
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

  const activeCount = history.filter((j) => ["draft", "queued", "processing"].includes(j.status)).length;
  const historyCount = history.filter((j) => ["completed", "failed"].includes(j.status)).length;

  return (
    <>
      <Masthead
        onNewJob={handleNewJob}
        onOpenSettings={() => setSettingsOpen(true)}
      />
      <TabNav
        activeTab={tab}
        onTabChange={setTab}
        activeBadge={activeCount}
        historyBadge={historyCount}
      />
      <main className="container">
        <StudioPanel
          hidden={tab !== "studio"}
          restoreJobId={urlJobId}
          onJobStarted={handleJobStarted}
          onJobCompleted={handleJobCompleted}
          onJobIdChange={setUrlJobId}
          onJobStatusChange={handleJobStatusChange}
        />
        <ActivePanel hidden={tab !== "active"} jobs={history} onRestore={handleRestore} />
        <HistoryPanel hidden={tab !== "history"} jobs={history} onRestore={handleRestore} onRemove={removeEntry} />
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
        <AppInner />
      </Suspense>
    </QueryClientProvider>
  );
}
