import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { withQueryClient } from "./test-utils";

// Stub all child components so the tests stay focused on StudioPanel's own
// orchestration: phase transitions, restore-from-URL, error banner, render POST.
vi.mock("@/client/components/studio/UploadCard", () => ({
  UploadCard: ({
    onSuccess,
    onError,
    onPhaseChange,
  }: {
    onSuccess: (d: unknown) => void;
    onError: (m: string) => void;
    onPhaseChange: (p: string) => void;
  }) => (
    <div>
      <button
        data-testid="upload-success"
        onClick={() =>
          onSuccess({
            job_id: "job-new",
            transcript: "hello world",
            duration: 5,
            filename: "audio.mp3",
            segments: [],
          })
        }
      >
        success
      </button>
      <button data-testid="upload-error" onClick={() => onError("boom")}>
        err
      </button>
      <button data-testid="upload-phase" onClick={() => onPhaseChange("transcribing")}>
        phase
      </button>
    </div>
  ),
}));
vi.mock("@/client/components/studio/ReviewCard", () => ({
  ReviewCard: ({ onConfirm }: { onConfirm: () => void }) => (
    <button data-testid="review-confirm" onClick={onConfirm}>
      confirm review
    </button>
  ),
}));
vi.mock("@/client/components/studio/PlanCard", () => ({
  PlanCard: ({
    onPlanSuccess,
  }: {
    onPlanSuccess: (d: { scenes: unknown[]; timeline: unknown[]; validator: Record<string, unknown> }) => void;
  }) => (
    <button
      data-testid="plan-success"
      onClick={() =>
        onPlanSuccess({
          scenes: [{ idx: 0, start_sec: 0, end_sec: 5 }],
          timeline: [{ scene_idx: 0, segment_id: "vid-1-s0" }],
          validator: { ok: true },
        })
      }
    >
      plan ok
    </button>
  ),
}));
vi.mock("@/client/components/studio/RenderCard", () => ({
  RenderCard: ({ onRenderStart }: { onRenderStart: () => void }) => (
    <button data-testid="render-start" onClick={onRenderStart}>
      start render
    </button>
  ),
}));
vi.mock("@/client/components/studio/OutputCard", () => ({
  OutputCard: () => <div data-testid="output-card" />,
}));
vi.mock("@/client/components/studio/WhyPanel", () => ({
  WhyPanel: () => <div data-testid="why-panel" />,
}));
vi.mock("@/client/components/studio/HeroStrip", () => ({
  HeroStrip: () => <div data-testid="hero-strip" />,
}));

const useJobStatusMock = vi.hoisted(() => vi.fn());
vi.mock("@/client/hooks/useJobStatus", () => ({
  useJobStatus: () => useJobStatusMock(),
}));

async function renderPanel(props: Partial<React.ComponentProps<typeof import("@/client/components/studio/StudioPanel").StudioPanel>> = {}) {
  const { StudioPanel } = await import("@/client/components/studio/StudioPanel");
  return render(withQueryClient(<StudioPanel {...props} />));
}

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  useJobStatusMock.mockReset();
  useJobStatusMock.mockReturnValue({ data: undefined });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("StudioPanel — initial phase", () => {
  it("shows UploadCard when no restoreJobId is given", async () => {
    await renderPanel();
    expect(screen.getByTestId("upload-success")).toBeTruthy();
  });

  it("upload success transitions to reviewing and fires lifecycle callbacks", async () => {
    const onJobStarted = vi.fn();
    const onJobIdChange = vi.fn();
    await renderPanel({ onJobStarted, onJobIdChange });

    fireEvent.click(screen.getByTestId("upload-success"));
    expect(onJobStarted).toHaveBeenCalledWith(
      "job-new",
      "audio.mp3",
      5,
      expect.any(String),
      "hello world",
    );
    expect(onJobIdChange).toHaveBeenCalledWith("job-new");
    // After upload success we should be in reviewing — UploadCard is gone.
    expect(screen.queryByTestId("upload-success")).toBeNull();
  });

  it("upload error surfaces in the error banner", async () => {
    const { container } = await renderPanel();
    fireEvent.click(screen.getByTestId("upload-error"));
    const banner = container.querySelector("#error-banner")!;
    expect(banner.textContent).toMatch(/boom/);
  });
});

describe("StudioPanel — render kickoff", () => {
  it("POSTs /api/render with the plan payload and stays in rendering on success", async () => {
    const fetchMock = mockFetch(async (url) => {
      if (url.toString() === "/api/render") {
        return new Response(JSON.stringify({ success: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    await renderPanel();
    fireEvent.click(screen.getByTestId("upload-success"));
    fireEvent.click(screen.getByTestId("plan-success"));
    fireEvent.click(screen.getByTestId("render-start"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [, init] = fetchMock.mock.calls[0]!;
    const body = JSON.parse(String((init as RequestInit).body));
    expect(body).toMatchObject({
      job_id: "job-new",
      audio_filename: "audio.mp3",
      timeline: expect.any(Array),
      scenes: expect.any(Array),
    });
  });

  it("surfaces an error banner when /api/render returns success=false", async () => {
    mockFetch(async () =>
      new Response(JSON.stringify({ success: false, error: "renderer angry" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );

    const { container } = await renderPanel();
    fireEvent.click(screen.getByTestId("upload-success"));
    fireEvent.click(screen.getByTestId("plan-success"));
    fireEvent.click(screen.getByTestId("render-start"));

    await waitFor(() => {
      const banner = container.querySelector("#error-banner")!;
      expect(banner.textContent).toMatch(/renderer angry/);
    });
  });

  it("surfaces an error banner when /api/render rejects", async () => {
    mockFetch(async () => {
      throw new Error("network down");
    });

    const { container } = await renderPanel();
    fireEvent.click(screen.getByTestId("upload-success"));
    fireEvent.click(screen.getByTestId("plan-success"));
    fireEvent.click(screen.getByTestId("render-start"));

    await waitFor(() => {
      const banner = container.querySelector("#error-banner")!;
      expect(banner.textContent).toMatch(/network down/);
    });
  });
});

describe("StudioPanel — restore from URL", () => {
  it("restores transcript + plan when /api/plan and /api/status both succeed", async () => {
    mockFetch(async (url) => {
      if (url.toString().startsWith("/api/plan/")) {
        return new Response(
          JSON.stringify({
            plan: {
              transcript: "restored hello",
              duration_sec: 12,
              audio_filename: "restored.mp3",
              transcript_segments: [],
              scenes: [{ idx: 0, start_sec: 0, end_sec: 12 }],
              timeline: [{ scene_idx: 0, segment_id: "vid-r-s0" }],
              validator: { ok: true },
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.toString().startsWith("/api/status/")) {
        return new Response(JSON.stringify({ status: "draft", output_url: null }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected: ${url}`);
    });

    await renderPanel({ restoreJobId: "job-restored" });
    // After restoring with a non-empty timeline, we land in 'planned' which
    // hides the UploadCard.
    await waitFor(() => expect(screen.queryByTestId("upload-success")).toBeNull());
  });

  it("plan 404 with 'Plan not found' surfaces the dedicated detail message", async () => {
    mockFetch(async (url) => {
      if (url.toString().startsWith("/api/plan/")) {
        return new Response(JSON.stringify({ error: "Plan not found" }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ status: "lost" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const { container } = await renderPanel({ restoreJobId: "abcdef1234" });
    await waitFor(() => {
      const banner = container.querySelector("#error-banner")!;
      expect(banner.textContent).toMatch(/Plan bundle missing for job abcdef12/);
    });
  });

  it("plan 500 surfaces a generic restore-failed message", async () => {
    mockFetch(async (url) => {
      if (url.toString().startsWith("/api/plan/")) {
        return new Response(null, { status: 500 });
      }
      return new Response(JSON.stringify({ status: "lost" }), { status: 200 });
    });

    const { container } = await renderPanel({ restoreJobId: "abcdef1234" });
    await waitFor(() => {
      const banner = container.querySelector("#error-banner")!;
      expect(banner.textContent).toMatch(/Could not restore job abcdef12/);
    });
  });
});

describe("StudioPanel — useJobStatus polling", () => {
  it("emits onJobCompleted when status flips to completed with an output_url", async () => {
    const onJobCompleted = vi.fn();
    useJobStatusMock.mockReturnValue({
      data: { status: "completed", output_url: "forecast_x.mp4" },
    });

    await renderPanel({ onJobCompleted });
    fireEvent.click(screen.getByTestId("upload-success"));

    await waitFor(() => expect(onJobCompleted).toHaveBeenCalledWith("job-new", "forecast_x.mp4"));
  });

  it("flips phase to failed when status reports failed and surfaces the error", async () => {
    useJobStatusMock.mockReturnValue({
      data: { status: "failed", error: "ffmpeg died", output_url: null },
    });

    const { container } = await renderPanel();
    fireEvent.click(screen.getByTestId("upload-success"));

    await waitFor(() => {
      const banner = container.querySelector("#error-banner")!;
      expect(banner.textContent).toMatch(/ffmpeg died/);
    });
  });
});
