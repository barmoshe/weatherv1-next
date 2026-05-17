import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { withQueryClient } from "./test-utils";

const mocks = vi.hoisted(() => ({
  useStorageStatus: vi.fn(),
  postFullR2Pull: vi.fn(),
  dispatchRefetchJobs: vi.fn(),
}));

vi.mock("@/client/hooks/useStorageStatus", () => ({
  useStorageStatus: mocks.useStorageStatus,
}));
vi.mock("@/client/lib/r2FullPull", () => ({
  postFullR2Pull: mocks.postFullR2Pull,
}));
vi.mock("@/client/hooks/useLocalHistory", () => ({
  dispatchRefetchJobs: mocks.dispatchRefetchJobs,
}));

type DesktopShim = Record<string, unknown> | undefined;

function readyStorage() {
  return {
    mode: "cloud" as const,
    cloud: {
      enabled: true,
      ready: true,
      catalogLoaded: true,
      counts: { local: 0, cloudOnly: 0, syncing: 0, error: 0 },
    },
    localCache: {
      role: "cache" as const,
      isDefault: true,
      workspaceDir: "/tmp",
      catalogPath: "/tmp/catalog.json",
      videosDir: "/tmp/videos",
      ready: true,
      missing: [],
      catalogCount: 0,
    },
  };
}

async function renderOverlay() {
  vi.resetModules();
  const mod = await import("@/client/components/storage/DesktopR2BootstrapOverlay");
  return render(withQueryClient(<mod.DesktopR2BootstrapOverlay />));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.useStorageStatus.mockReturnValue({ data: null, refetch: vi.fn() });
  (window as unknown as { desktop?: DesktopShim }).desktop = { ping: () => {} };
});

afterEach(() => {
  vi.restoreAllMocks();
  (window as unknown as { desktop?: DesktopShim }).desktop = undefined;
});

describe("DesktopR2BootstrapOverlay", () => {
  it("renders nothing while the storage status is still loading", async () => {
    mocks.useStorageStatus.mockReturnValue({ data: undefined, refetch: vi.fn() });
    await renderOverlay();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.postFullR2Pull).not.toHaveBeenCalled();
  });

  it("renders nothing when the desktop shim is absent (web mode)", async () => {
    (window as unknown as { desktop?: DesktopShim }).desktop = undefined;
    mocks.useStorageStatus.mockReturnValue({ data: readyStorage(), refetch: vi.fn() });
    await renderOverlay();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.postFullR2Pull).not.toHaveBeenCalled();
  });

  it("renders nothing when cloud is not ready", async () => {
    const s = readyStorage();
    s.cloud.ready = false;
    mocks.useStorageStatus.mockReturnValue({ data: s, refetch: vi.fn() });
    await renderOverlay();
    expect(screen.queryByRole("status")).toBeNull();
    expect(mocks.postFullR2Pull).not.toHaveBeenCalled();
  });

  it("triggers a full pull when desktop + cloud + localCache are all ready", async () => {
    mocks.postFullR2Pull.mockResolvedValueOnce(undefined);
    const refetch = vi.fn().mockResolvedValue({});
    mocks.useStorageStatus.mockReturnValue({ data: readyStorage(), refetch });

    await renderOverlay();

    // Pull is awaited inside useLayoutEffect → wait for it.
    await waitFor(() => expect(mocks.postFullR2Pull).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.dispatchRefetchJobs).toHaveBeenCalledTimes(1));

    // Overlay disappears after the pull resolves.
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
  });

  it("swallows pull errors and does not dispatchRefetchJobs", async () => {
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.postFullR2Pull.mockRejectedValueOnce(new Error("pull down"));
    mocks.useStorageStatus.mockReturnValue({ data: readyStorage(), refetch: vi.fn() });

    await renderOverlay();

    await waitFor(() => expect(mocks.postFullR2Pull).toHaveBeenCalled());
    // Give the rejection handler time to fire.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.dispatchRefetchJobs).not.toHaveBeenCalled();
    spy.mockRestore();
  });

});
