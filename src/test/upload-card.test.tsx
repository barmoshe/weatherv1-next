import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

// The desktop module reads `window.desktop` at import time. We control it
// per-test by setting `window.desktop` before vi.resetModules + dynamic
// import.
type DesktopShim = { pickAudioFile: ReturnType<typeof vi.fn> } | undefined;

declare global {
  // eslint-disable-next-line no-var
  var __testDesktopShim: DesktopShim;
}

async function renderUploadCard(
  props: Partial<React.ComponentProps<typeof import("@/client/components/studio/UploadCard").UploadCard>> = {},
) {
  vi.resetModules();
  const { UploadCard } = await import("@/client/components/studio/UploadCard");
  return render(
    <UploadCard
      onSuccess={() => {}}
      onError={() => {}}
      onPhaseChange={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  // Default: no desktop shim. Tests that need it set it explicitly.
  (window as unknown as { desktop?: DesktopShim }).desktop = undefined;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  (window as unknown as { desktop?: DesktopShim }).desktop = undefined;
});

function mockFetchResponse(body: object, init?: ResponseInit) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
      ...init,
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("UploadCard — drag/drop & file input", () => {
  it("toggles is-dragover class while dragging", async () => {
    const { container } = await renderUploadCard({});
    const zone = container.querySelector("#drop-zone")!;
    fireEvent.dragOver(zone);
    expect(zone.className).toContain("is-dragover");
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("is-dragover");
  });

  it("dropping an audio file POSTs to /api/transcribe and emits onSuccess", async () => {
    const fetchMock = mockFetchResponse({
      success: true,
      job_id: "job-1",
      transcript: "hi",
      duration: 5,
      filename: "x.mp3",
      segments: [],
    });

    const onSuccess = vi.fn();
    const onPhaseChange = vi.fn();
    const { container } = await renderUploadCard({ onSuccess, onPhaseChange });

    const file = new File(["audio"], "x.mp3", { type: "audio/mpeg" });
    const zone = container.querySelector("#drop-zone")!;
    fireEvent.drop(zone, { dataTransfer: { files: [file] } });

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());

    expect(onPhaseChange).toHaveBeenCalledWith("transcribing");
    expect(onSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        job_id: "job-1",
        transcript: "hi",
        duration: 5,
        filename: "x.mp3",
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/transcribe");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).body).toBeInstanceOf(FormData);
  });

  it("file input change also triggers upload", async () => {
    mockFetchResponse({
      success: true,
      job_id: "j2",
      transcript: "",
      duration: 0,
      filename: "y.wav",
      segments: [],
    });
    const onSuccess = vi.fn();
    const { container } = await renderUploadCard({ onSuccess });

    const input = container.querySelector("#file-input") as HTMLInputElement;
    const file = new File(["audio"], "y.wav", { type: "audio/wav" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
  });

  it("calls onError and reverts the phase when the API returns success=false", async () => {
    mockFetchResponse({ success: false, error: "whisper bad" });
    const onError = vi.fn();
    const onPhaseChange = vi.fn();
    const { container } = await renderUploadCard({ onError, onPhaseChange });

    const file = new File(["a"], "a.mp3", { type: "audio/mpeg" });
    fireEvent.drop(container.querySelector("#drop-zone")!, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toMatch(/whisper bad/);
    expect(onPhaseChange).toHaveBeenLastCalledWith("upload");
  });

  it("calls onError when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("net down")));
    const onError = vi.fn();
    const { container } = await renderUploadCard({ onError });

    const file = new File(["a"], "a.mp3", { type: "audio/mpeg" });
    fireEvent.drop(container.querySelector("#drop-zone")!, {
      dataTransfer: { files: [file] },
    });

    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(onError.mock.calls[0]![0]).toMatch(/net down/);
  });
});

describe("UploadCard — desktop branch", () => {
  it("clicking the CTA calls desktop.pickAudioFile and POSTs JSON", async () => {
    const pickAudioFile = vi.fn().mockResolvedValue({
      path: "/abs/path/to/audio.mp3",
      name: "audio.mp3",
    });
    (window as unknown as { desktop?: DesktopShim }).desktop = { pickAudioFile };

    const fetchMock = mockFetchResponse({
      success: true,
      job_id: "j-desk",
      transcript: "hi",
      duration: 2,
      filename: "audio.mp3",
      segments: [],
    });
    const onSuccess = vi.fn();
    await renderUploadCard({ onSuccess });

    fireEvent.click(screen.getByText("בחר קובץ"));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(pickAudioFile).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/transcribe");
    expect((init as RequestInit).method).toBe("POST");
    expect((init as RequestInit).headers).toMatchObject({ "content-type": "application/json" });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      desktop_file_path: "/abs/path/to/audio.mp3",
    });
  });

  it("no-ops when desktop.pickAudioFile returns null (user cancelled)", async () => {
    const pickAudioFile = vi.fn().mockResolvedValue(null);
    (window as unknown as { desktop?: DesktopShim }).desktop = { pickAudioFile };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const onSuccess = vi.fn();
    await renderUploadCard({ onSuccess });

    fireEvent.click(screen.getByText("בחר קובץ"));
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
