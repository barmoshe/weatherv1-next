import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SettingsCloudPanel } from "@/client/components/studio/settings/SettingsCloudPanel";
import type { DesktopAppInfo } from "@/shared/desktop";
import type { DesktopStatus } from "@/client/components/studio/settings/settingsTypes";

function noopHandlers() {
  return {
    onR2GatewayUrlChange: vi.fn(),
    onR2TenantIdChange: vi.fn(),
    onR2BucketNameChange: vi.fn(),
    onR2AppUsernameChange: vi.fn(),
    onR2AppPasswordChange: vi.fn(),
    onR2EnabledChange: vi.fn(),
    onShowR2PasswordToggle: vi.fn(),
    onClearR2Key: vi.fn(),
    onPullCatalogFromR2: vi.fn(),
    onPushCatalogToR2: vi.fn(),
    onExportJobsFromR2: vi.fn(),
  };
}

function defaultStatus(overrides?: Partial<DesktopStatus["r2"]>): DesktopStatus {
  return {
    workspaceDir: "/tmp",
    catalogPath: "/tmp/catalog.json",
    videosDir: "/tmp/videos",
    musicDir: "/tmp/music",
    ffmpegPath: null,
    ffprobePath: null,
    bgMusicPath: null,
    workspace: { ready: true, missing: [] },
    r2: {
      enabled: true,
      ready: true,
      gatewayUrl: "https://gw/",
      appUsername: "weatherv1",
      bucketName: "bucket",
      tenantId: "t1",
      tenantPrefix: "tenants/t1",
      lastCatalogEtag: undefined,
      lastSyncAt: undefined,
      conflict: undefined,
      counts: { local: 1, cloudOnly: 0, syncing: 0, error: 0 },
      mirror: undefined,
      error: undefined,
      ...overrides,
    },
  } as unknown as DesktopStatus;
}

const baseProps = (overrides: Partial<React.ComponentProps<typeof SettingsCloudPanel>> = {}) => ({
  appInfo: { packaged: false } as DesktopAppInfo,
  desktopStatus: defaultStatus(),
  saving: false,
  syncingR2: false,
  exportR2JobsLoading: false,
  r2Enabled: true,
  r2GatewayUrl: "https://gw/",
  r2TenantId: "t1",
  r2BucketName: "bucket",
  r2AppUsername: "weatherv1",
  r2AppPassword: "secret",
  showR2Password: false,
  ...noopHandlers(),
  ...overrides,
});

describe("SettingsCloudPanel — dev mode", () => {
  it("renders editable form fields when not packaged", () => {
    render(<SettingsCloudPanel {...baseProps()} />);
    expect(screen.getByPlaceholderText("https://weatherv1-r2-gateway.example.workers.dev")).toBeTruthy();
    expect(screen.getByPlaceholderText("default")).toBeTruthy();
    expect(screen.getByPlaceholderText("weatherv1-media")).toBeTruthy();
  });

  it("fires onR2GatewayUrlChange when the gateway field is edited", () => {
    const onR2GatewayUrlChange = vi.fn();
    render(<SettingsCloudPanel {...baseProps({ onR2GatewayUrlChange })} />);
    const input = screen.getByPlaceholderText("https://weatherv1-r2-gateway.example.workers.dev");
    fireEvent.change(input, { target: { value: "https://new" } });
    expect(onR2GatewayUrlChange).toHaveBeenCalledWith("https://new");
  });

  it("fires onR2EnabledChange when the enable checkbox toggles", () => {
    const onR2EnabledChange = vi.fn();
    render(<SettingsCloudPanel {...baseProps({ onR2EnabledChange, r2Enabled: false })} />);
    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    fireEvent.click(checkbox);
    expect(onR2EnabledChange).toHaveBeenCalledWith(true);
  });

  it("password field type flips between text and password based on showR2Password", () => {
    const { rerender, container } = render(
      <SettingsCloudPanel {...baseProps({ showR2Password: false })} />,
    );
    const passwordInput = container.querySelector(".settings-password__input") as HTMLInputElement;
    expect(passwordInput.type).toBe("password");

    rerender(<SettingsCloudPanel {...baseProps({ showR2Password: true })} />);
    const after = container.querySelector(".settings-password__input") as HTMLInputElement;
    expect(after.type).toBe("text");
  });

  it("clicking 'הצג' fires onShowR2PasswordToggle", () => {
    const onShowR2PasswordToggle = vi.fn();
    render(<SettingsCloudPanel {...baseProps({ onShowR2PasswordToggle })} />);
    fireEvent.click(screen.getByLabelText("הצג סיסמה"));
    expect(onShowR2PasswordToggle).toHaveBeenCalledTimes(1);
  });

  it("clicking 'דחוף קטלוג' fires onPushCatalogToR2(false)", () => {
    const onPushCatalogToR2 = vi.fn();
    render(<SettingsCloudPanel {...baseProps({ onPushCatalogToR2 })} />);
    fireEvent.click(screen.getByText("דחוף קטלוג"));
    expect(onPushCatalogToR2).toHaveBeenCalledWith(false);
  });

  it("'החלף מרוחק' only renders when there is a conflict, and fires push(true)", () => {
    const onPushCatalogToR2 = vi.fn();
    const { rerender } = render(<SettingsCloudPanel {...baseProps({ onPushCatalogToR2 })} />);
    expect(screen.queryByText("החלף מרוחק")).toBeNull();

    rerender(
      <SettingsCloudPanel
        {...baseProps({
          onPushCatalogToR2,
          desktopStatus: defaultStatus({
            conflict: { remoteEtag: "x", localHash: "y", detectedAt: "z" },
          }),
        })}
      />,
    );
    fireEvent.click(screen.getByText("החלף מרוחק"));
    expect(onPushCatalogToR2).toHaveBeenCalledWith(true);
  });
});

describe("SettingsCloudPanel — packaged mode", () => {
  it("hides editable form fields and shows status grid", () => {
    render(<SettingsCloudPanel {...baseProps({ appInfo: { packaged: true } as DesktopAppInfo })} />);
    expect(screen.queryByPlaceholderText("https://weatherv1-r2-gateway.example.workers.dev")).toBeNull();
    expect(screen.getByText("מחובר")).toBeTruthy();
  });

  it("'התנתק (נקה סיסמה)' renders only when R2 is ready, and fires onClearR2Key", () => {
    const onClearR2Key = vi.fn();
    const { rerender } = render(
      <SettingsCloudPanel
        {...baseProps({
          appInfo: { packaged: true } as DesktopAppInfo,
          onClearR2Key,
        })}
      />,
    );
    fireEvent.click(screen.getByText("התנתק (נקה סיסמה)"));
    expect(onClearR2Key).toHaveBeenCalledTimes(1);

    rerender(
      <SettingsCloudPanel
        {...baseProps({
          appInfo: { packaged: true } as DesktopAppInfo,
          onClearR2Key,
          desktopStatus: defaultStatus({ ready: false, enabled: true }),
        })}
      />,
    );
    expect(screen.queryByText("התנתק (נקה סיסמה)")).toBeNull();
    expect(screen.getByText("ממתין להתחברות")).toBeTruthy();
  });
});

describe("SettingsCloudPanel — action button gating", () => {
  it("disables push/pull when R2 is not ready", () => {
    render(
      <SettingsCloudPanel
        {...baseProps({ desktopStatus: defaultStatus({ ready: false, enabled: true }) })}
      />,
    );
    const push = screen.getByText("דחוף קטלוג") as HTMLButtonElement;
    expect(push.disabled).toBe(true);
  });

  it("disables push when syncingR2 is true", () => {
    render(<SettingsCloudPanel {...baseProps({ syncingR2: true })} />);
    const push = screen.getByText("דחוף קטלוג") as HTMLButtonElement;
    expect(push.disabled).toBe(true);
  });

  it("Export JSON only renders when R2 is enabled", () => {
    const { rerender } = render(
      <SettingsCloudPanel
        {...baseProps({ desktopStatus: defaultStatus({ enabled: false }) })}
      />,
    );
    expect(screen.queryByText("Export JSON")).toBeNull();

    rerender(<SettingsCloudPanel {...baseProps()} />);
    expect(screen.getByText("Export JSON")).toBeTruthy();
  });
});
