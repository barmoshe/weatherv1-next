import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useJobStatus } from "@/client/hooks/useJobStatus";
import { mergeHistoryEntries, type HistoryEntry } from "@/client/hooks/useLocalHistory";
import { ActivePanel } from "@/client/components/jobs/ActivePanel";
import { HistoryPanel } from "@/client/components/jobs/HistoryPanel";

afterEach(() => {
  vi.restoreAllMocks();
});

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
    },
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const lostJob: HistoryEntry = {
  job_id: "job-lost",
  created_at: "2026-05-12T10:00:00.000Z",
  transcript_preview: "missing forecast",
  status: "lost",
};

describe("lost jobs", () => {
  it("maps a missing status response to a terminal lost job", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 404 }));

    const { result } = renderHook(() => useJobStatus("job-lost"), { wrapper });

    await waitFor(() => {
      expect(result.current.data?.status).toBe("lost");
    });
    expect(result.current.data?.error).toBe("Job not found");
  });

  it("moves lost jobs out of Active and into History", () => {
    render(
      <>
        <ActivePanel jobs={[lostJob]} />
        <HistoryPanel jobs={[lostJob]} />
      </>,
    );

    expect(screen.getByText("אין רינדורים פעילים.")).toBeInTheDocument();
    expect(screen.getByText("missing forecast")).toBeInTheDocument();
    expect(screen.getByText("לא נמצא")).toBeInTheDocument();
  });

  it("shows delete controls for active jobs", () => {
    const onRemove = vi.fn();
    render(<ActivePanel jobs={[{ ...lostJob, status: "draft" }]} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole("button", { name: "מחק" }));

    expect(onRemove).toHaveBeenCalledWith("job-lost");
  });

  it("imports persisted server jobs while preserving richer local metadata", () => {
    const merged = mergeHistoryEntries(
      [
        {
          job_id: "job-completed",
          created_at: "2026-05-12T10:00:00.000Z",
          transcript_preview: "local preview",
          duration_sec: 12,
          status: "draft",
        },
      ],
      [
        {
          job_id: "job-completed",
          created_at: "2026-05-12T10:00:00.000Z",
          output_url: "forecast_job-completed.mp4",
          status: "completed",
        },
        {
          job_id: "job-old",
          created_at: "2026-05-11T10:00:00.000Z",
          status: "completed",
        },
      ],
    );

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      job_id: "job-completed",
      status: "completed",
      output_url: "forecast_job-completed.mp4",
      transcript_preview: "local preview",
      duration_sec: 12,
    });
    expect(merged[1]).toMatchObject({ job_id: "job-old", status: "completed" });
  });
});
