// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  mergeHistoryEntries,
  useLocalHistory,
  type HistoryEntry,
} from "@/client/hooks/useLocalHistory";

function entry(id: string, status = "completed", createdAt = "2026-05-17T10:00:00.000Z"): HistoryEntry {
  return { job_id: id, created_at: createdAt, status };
}

function jobsResponse(jobs: HistoryEntry[]): Response {
  return new Response(JSON.stringify({ success: true, jobs }), { status: 200 });
}

/** Flush pending microtasks so awaited fetch promises resolve under fake timers. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("mergeHistoryEntries — deletion semantics", () => {
  it("drops local rows that the server no longer returns (R2 pull / archive)", () => {
    const local = [entry("kept"), entry("gone")];
    const persisted = [entry("kept"), entry("new")];
    const merged = mergeHistoryEntries(local, persisted);
    const ids = merged.map((e) => e.job_id).sort();
    expect(ids).toEqual(["kept", "new"]);
  });

  it("collapses everything to empty when the server returns an empty list", () => {
    const merged = mergeHistoryEntries([entry("a"), entry("b")], []);
    expect(merged).toEqual([]);
  });
});

describe("useLocalHistory polling cadence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    vi.stubGlobal("fetch", vi.fn(async () => jobsResponse([])));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("uses the slow (~30s) ambient cadence when no jobs are active", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderHook(() => useLocalHistory());

    // Initial mount fetch.
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Half-way through the 30s window: no extra fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Crossing 30s: the interval fires once.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not fetch on the interval while the tab is hidden", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderHook(() => useLocalHistory());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    // Mount fetch only — interval should have early-returned on hidden checks.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("immediately refetches when the tab becomes visible again", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderHook(() => useLocalHistory());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("refetches when a weatherv1-refetch-jobs event fires (Pull-from-R2 path)", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    renderHook(() => useLocalHistory());
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new CustomEvent("weatherv1-refetch-jobs"));
    });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
