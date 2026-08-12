import { describe, expect, it } from "vitest";
import { derivePhase } from "@/client/components/storage/StorageOnboardingGate";
import type { StorageStatus } from "@/client/hooks/useStorageStatus";
import type { DesktopAppInfo } from "@/shared/desktop";

function storage(patch: {
  mode?: StorageStatus["mode"];
  cloud?: Partial<StorageStatus["cloud"]>;
  localCache?: Partial<StorageStatus["localCache"]>;
}): StorageStatus {
  return {
    mode: patch.mode ?? "local",
    cloud: {
      enabled: false,
      ready: false,
      counts: { local: 0, cloudOnly: 0, syncing: 0, error: 0 },
      catalogLoaded: false,
      ...patch.cloud,
    },
    localCache: {
      role: "workspace",
      isDefault: true,
      workspaceDir: "/tmp/workspace",
      catalogPath: "/tmp/workspace/notouch!/catalog.json",
      videosDir: "/tmp/workspace/videos",
      ready: true,
      missing: [],
      catalogCount: 0,
      presentCount: 0,
      ...patch.localCache,
    },
  };
}

const appInfo = (packaged: boolean): DesktopAppInfo =>
  ({ packaged, appVersion: "0.0.0" }) as DesktopAppInfo;

const base = { desktopAvailable: true, appInfoReady: true };

describe("StorageOnboardingGate derivePhase", () => {
  it("hides outside the desktop shell and loads until status arrives", () => {
    expect(
      derivePhase({ desktopAvailable: false, appInfo: null, appInfoReady: true, storage: storage({}) }),
    ).toBe("hidden");
    expect(
      derivePhase({ ...base, appInfo: appInfo(true), storage: undefined }),
    ).toBe("loading");
  });

  it("shows the local-setup wizard when the workspace is not a real library", () => {
    // Empty cache: pulled catalog but zero files on disk.
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(true),
        storage: storage({ localCache: { catalogCount: 212, presentCount: 0 } }),
      }),
    ).toBe("local-setup");
    // Fresh install: no catalog at all.
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(false),
        storage: storage({ localCache: { catalogCount: 0 } }),
      }),
    ).toBe("local-setup");
  });

  it("shows the wizard in the dev shell too", () => {
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(false),
        storage: storage({ localCache: { catalogCount: 212, presentCount: 0 } }),
      }),
    ).toBe("local-setup");
  });

  it("is ready once the local library has files on disk", () => {
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(true),
        storage: storage({ localCache: { catalogCount: 212, presentCount: 212 } }),
      }),
    ).toBe("ready");
  });

  it("stays in setup when the workspace has healthy counts but missing subdirs", () => {
    // e.g. a picked library without music/ — the card must surface missing[].
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(true),
        storage: storage({
          localCache: {
            catalogCount: 212,
            presentCount: 212,
            ready: false,
            missing: ["music"],
          },
        }),
      }),
    ).toBe("local-setup");
  });

  it("keeps the cloud phases unchanged in cloud mode", () => {
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(true),
        storage: storage({
          mode: "cloud",
          cloud: { enabled: true, ready: false, error: "auth rejected" },
        }),
      }),
    ).toBe("cloud-reconnect");
    // Dev shells never see the cloud-first onboarding.
    expect(
      derivePhase({
        ...base,
        appInfo: appInfo(false),
        storage: storage({ mode: "cloud", cloud: { enabled: true, ready: true } }),
      }),
    ).toBe("hidden");
  });
});
