import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { CatalogPickerModal } from "@/client/components/studio/CatalogPickerModal";
import type { ParsedVideo, Scene } from "@/shared/types";

const useCatalogMock = vi.hoisted(() => vi.fn());

vi.mock("@/client/hooks/useCatalog", () => ({
  useCatalog: () => useCatalogMock(),
}));

function makeVideo(
  id: string,
  segments: { id: string; tags?: string[]; start_sec?: number; end_sec?: number; description?: string }[],
): ParsedVideo {
  return {
    id,
    filename: `${id}.mp4`,
    description: "",
    duration_sec: 30,
    orientation: "V",
    source: "original",
    tags: { main: "", secondary: "", third: "" },
    segments: segments.map((s) => ({
      id: s.id,
      start_sec: s.start_sec ?? 0,
      end_sec: s.end_sec ?? 10,
      description: s.description ?? "",
      tags: s.tags ?? [],
      concepts: undefined,
    })),
    path: `/videos/${id}.mp4`,
    availability: "local",
  } as unknown as ParsedVideo;
}

const scene: Scene = {
  idx: 0,
  start_sec: 0,
  end_sec: 8,
  title_he: "שרב",
  narration: "שרב",
  keywords: ["heat"],
  kind: "prose",
  heterogeneous: false,
  whisper_beat_indices: [],
} as unknown as Scene;

const baseProps = (overrides: Partial<React.ComponentProps<typeof CatalogPickerModal>> = {}) => ({
  scene,
  jobId: "job-1",
  scenes: [scene],
  timeline: [],
  mode: "pick-swap" as const,
  pickIndex: 0,
  pick: undefined,
  excludeSegmentIds: [],
  onClose: vi.fn(),
  onCommitted: vi.fn(),
  ...overrides,
});

beforeEach(() => {
  useCatalogMock.mockReset();
  useCatalogMock.mockReturnValue({
    data: [
      makeVideo("vid-A", [
        { id: "vid-A-s0", tags: ["heat"], description: "heat scene" },
      ]),
      makeVideo("vid-B", [
        { id: "vid-B-s0", tags: ["cold"], description: "snowy" },
      ]),
    ],
    isLoading: false,
    isError: false,
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mockPickResponse(body: object, init?: ResponseInit) {
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

describe("CatalogPickerModal", () => {
  it("shows the loading hint when useCatalog is loading", () => {
    useCatalogMock.mockReturnValueOnce({ data: [], isLoading: true, isError: false });
    render(<CatalogPickerModal {...baseProps()} />);
    expect(screen.getByText("טוען קטלוג…")).toBeTruthy();
  });

  it("shows the error hint when useCatalog reports an error", () => {
    useCatalogMock.mockReturnValueOnce({ data: [], isLoading: false, isError: true });
    render(<CatalogPickerModal {...baseProps()} />);
    expect(screen.getByText("לא ניתן לטעון את הקטלוג")).toBeTruthy();
  });

  it("ranks scene-matching segments first and hides non-matches in default mode", () => {
    render(<CatalogPickerModal {...baseProps()} />);
    // 'heat' is in scene.keywords; vid-A-s0 has tag 'heat'. vid-B-s0 ('cold') should be hidden.
    expect(screen.getByText("vid-A-s0")).toBeTruthy();
    expect(screen.queryByText("vid-B-s0")).toBeNull();
  });

  it("'הצג הכול' reveals non-matching segments", () => {
    render(<CatalogPickerModal {...baseProps()} />);
    fireEvent.click(screen.getByText("הצג הכול"));
    expect(screen.getByText("vid-B-s0")).toBeTruthy();
  });

  it("search filters the visible list", () => {
    render(<CatalogPickerModal {...baseProps()} />);
    fireEvent.click(screen.getByText("הצג הכול"));
    const searchInput = screen.getByPlaceholderText(/חפש/);
    fireEvent.change(searchInput, { target: { value: "snowy" } });
    expect(screen.getByText("vid-B-s0")).toBeTruthy();
    expect(screen.queryByText("vid-A-s0")).toBeNull();
  });

  it("selecting a row populates the preview pane", () => {
    render(<CatalogPickerModal {...baseProps()} />);
    fireEvent.click(screen.getByRole("option", { name: /vid-A-s0/ }));
    expect(screen.queryByText("בחר קליפ מהרשימה כדי לראות תצוגה מקדימה.")).toBeNull();
  });

  it("confirm POSTs to /api/pick_segment and emits onCommitted + onClose (pick-swap mode)", async () => {
    const fetchMock = mockPickResponse({
      success: true,
      timeline: [{ scene_idx: 0, segment_id: "vid-A-s0" }],
      validator: { ok: true },
    });
    const onCommitted = vi.fn();
    const onClose = vi.fn();
    render(<CatalogPickerModal {...baseProps({ onCommitted, onClose, mode: "pick-swap" })} />);

    fireEvent.click(screen.getByRole("option", { name: /vid-A-s0/ }));
    fireEvent.click(screen.getByText("אשר בחירה"));

    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/pick_segment");
    expect((init as RequestInit).method).toBe("POST");
    expect(JSON.parse(String((init as RequestInit).body))).toMatchObject({
      job_id: "job-1",
      scene_idx: 0,
      pick_index: 0,
      new_segment_id: "vid-A-s0",
    });
  });

  it("scene-fill mode keeps the modal open after confirm and clears selection", async () => {
    mockPickResponse({ success: true, timeline: [], validator: {} });
    const onCommitted = vi.fn();
    const onClose = vi.fn();
    render(<CatalogPickerModal {...baseProps({ onCommitted, onClose, mode: "scene-fill" })} />);

    fireEvent.click(screen.getByRole("option", { name: /vid-A-s0/ }));
    fireEvent.click(screen.getByText("אשר בחירה"));
    await waitFor(() => expect(onCommitted).toHaveBeenCalled());
    expect(onClose).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByText("בחר קליפ מהרשימה כדי לראות תצוגה מקדימה.")).toBeTruthy(),
    );
  });

  it("surfaces an inline error when the API responds with success=false", async () => {
    mockPickResponse({ success: false, error: "validator angry" });
    render(<CatalogPickerModal {...baseProps()} />);
    fireEvent.click(screen.getByRole("option", { name: /vid-A-s0/ }));
    fireEvent.click(screen.getByText("אשר בחירה"));
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByRole("alert").textContent).toMatch(/validator angry/);
  });

  it("Escape key triggers onClose", () => {
    const onClose = vi.fn();
    render(<CatalogPickerModal {...baseProps({ onClose })} />);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("backdrop click also triggers onClose", () => {
    const onClose = vi.fn();
    const { container } = render(<CatalogPickerModal {...baseProps({ onClose })} />);
    const backdrop = container.querySelector(".modal-backdrop")!;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("confirm button is disabled until a segment is selected", () => {
    render(<CatalogPickerModal {...baseProps()} />);
    const confirm = screen.getByText("אשר בחירה") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.click(screen.getByRole("option", { name: /vid-A-s0/ }));
    expect((screen.getByText("אשר בחירה") as HTMLButtonElement).disabled).toBe(false);
  });
});
