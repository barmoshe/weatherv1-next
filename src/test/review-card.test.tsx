import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ReviewCard } from "@/client/components/studio/ReviewCard";

const baseTranscript = {
  job_id: "job-abc",
  transcript: "hello world",
  duration: 12,
  filename: "abc.mp3",
  segments: [],
};

describe("ReviewCard", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("renders an audio element pointing at /api/voiceovers/<jobId>", () => {
    render(
      <ReviewCard
        jobId="job-abc"
        transcriptData={baseTranscript}
        tileState="active"
        phase="reviewing"
        onTranscriptChange={() => {}}
        onConfirm={() => {}}
        onError={() => {}}
      />,
    );
    const audio = screen.getByTestId("review-audio") as HTMLAudioElement;
    expect(audio.getAttribute("src")).toBe("/api/voiceovers/job-abc");
  });

  it("clean Continue skips PATCH and calls onConfirm", async () => {
    const onConfirm = vi.fn();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    render(
      <ReviewCard
        jobId="job-abc"
        transcriptData={baseTranscript}
        tileState="active"
        phase="reviewing"
        onTranscriptChange={() => {}}
        onConfirm={onConfirm}
        onError={() => {}}
      />,
    );
    fireEvent.click(screen.getByTestId("review-continue"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("dirty Continue PATCHes transcript then calls onConfirm", async () => {
    const onConfirm = vi.fn();
    const onTranscriptChange = vi.fn();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, transcript: "edited text", segments: [] }),
    });

    render(
      <ReviewCard
        jobId="job-abc"
        transcriptData={baseTranscript}
        tileState="active"
        phase="reviewing"
        onTranscriptChange={onTranscriptChange}
        onConfirm={onConfirm}
        onError={() => {}}
      />,
    );

    const ta = screen.getByTestId("review-textarea") as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: "edited text" } });
    fireEvent.click(screen.getByTestId("review-continue"));

    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/transcript/job-abc");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ transcript: "edited text" });
    expect(onTranscriptChange).toHaveBeenCalledWith("edited text");
  });

  it("renders one row per segment with play button, time, and editable text", () => {
    const segmented = {
      ...baseTranscript,
      transcript: "first sentence second sentence",
      segments: [
        { start: 0, end: 2.5, text: "first sentence" },
        { start: 2.5, end: 5.0, text: "second sentence" },
      ],
    };
    render(
      <ReviewCard
        jobId="job-abc"
        transcriptData={segmented}
        tileState="active"
        phase="reviewing"
        onTranscriptChange={() => {}}
        onConfirm={() => {}}
        onError={() => {}}
      />,
    );
    // Compact layout: each segment gets its own play button + textarea, and
    // the fallback single textarea is NOT rendered.
    expect(screen.getByTestId("review-segment-play-0")).toBeTruthy();
    expect(screen.getByTestId("review-segment-play-1")).toBeTruthy();
    expect((screen.getByTestId("review-segment-text-0") as HTMLTextAreaElement).value).toBe(
      "first sentence",
    );
    expect((screen.getByTestId("review-segment-text-1") as HTMLTextAreaElement).value).toBe(
      "second sentence",
    );
    expect(screen.queryByTestId("review-textarea")).toBeNull();
  });

  it("segment edits accumulate into the PATCHed transcript", async () => {
    const onConfirm = vi.fn();
    const onTranscriptChange = vi.fn();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, transcript: "alpha edited", segments: [] }),
    });
    const segmented = {
      ...baseTranscript,
      transcript: "alpha beta",
      segments: [
        { start: 0, end: 1, text: "alpha" },
        { start: 1, end: 2, text: "beta" },
      ],
    };
    render(
      <ReviewCard
        jobId="job-abc"
        transcriptData={segmented}
        tileState="active"
        phase="reviewing"
        onTranscriptChange={onTranscriptChange}
        onConfirm={onConfirm}
        onError={() => {}}
      />,
    );
    fireEvent.change(screen.getByTestId("review-segment-text-1"), {
      target: { value: "edited" },
    });
    fireEvent.click(screen.getByTestId("review-continue"));
    await waitFor(() => expect(onConfirm).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ transcript: "alpha edited" });
  });

  it("surfaces errors via onError when PATCH fails", async () => {
    const onConfirm = vi.fn();
    const onError = vi.fn();
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ success: false, error: "boom" }),
    });

    render(
      <ReviewCard
        jobId="job-abc"
        transcriptData={baseTranscript}
        tileState="active"
        phase="reviewing"
        onTranscriptChange={() => {}}
        onConfirm={onConfirm}
        onError={onError}
      />,
    );

    fireEvent.change(screen.getByTestId("review-textarea"), { target: { value: "new" } });
    fireEvent.click(screen.getByTestId("review-continue"));

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
