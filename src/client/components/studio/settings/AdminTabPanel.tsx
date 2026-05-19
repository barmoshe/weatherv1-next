"use client";

import type { ComponentProps } from "react";

import { AdminPasswordPrompt } from "./AdminPasswordPrompt";
import { SettingsAiPanel } from "./SettingsAiPanel";
import { SettingsCatalogPanel } from "./SettingsCatalogPanel";
import { SettingsCloudPanel } from "./SettingsCloudPanel";
import { SettingsDesktopPanel } from "./SettingsDesktopPanel";
import { SettingsPipelinePanel } from "./SettingsPipelinePanel";

type CatalogProps = ComponentProps<typeof SettingsCatalogPanel>;
type DesktopProps = ComponentProps<typeof SettingsDesktopPanel>;
type AiProps = ComponentProps<typeof SettingsAiPanel>;
type CloudProps = ComponentProps<typeof SettingsCloudPanel>;
type PipelineProps = ComponentProps<typeof SettingsPipelinePanel>;

interface AdminTabPanelProps {
  unlocked: boolean;
  onUnlocked: () => void;
  onLock: () => void;
  catalog: CatalogProps;
  desktop: DesktopProps;
  ai: AiProps;
  cloud: CloudProps;
  pipeline: PipelineProps;
}

export function AdminTabPanel({
  unlocked,
  onUnlocked,
  onLock,
  catalog,
  desktop,
  ai,
  cloud,
  pipeline,
}: AdminTabPanelProps) {
  if (!unlocked) {
    return <AdminPasswordPrompt onUnlocked={onUnlocked} />;
  }

  return (
    <div className="settings-admin-tab" dir="rtl">
      <div
        className="settings-section-header"
        style={{ justifyContent: "flex-end", marginBlockEnd: "0.5rem" }}
      >
        <button type="button" className="btn btn--ghost" onClick={onLock}>
          נעל ניהול
        </button>
      </div>

      <section className="settings-admin-section">
        <h3 className="settings-admin-section-heading">קטלוג</h3>
        <SettingsCatalogPanel {...catalog} />
      </section>

      <section className="settings-admin-section">
        <h3 className="settings-admin-section-heading">דסקטופ וקבצים</h3>
        <SettingsDesktopPanel {...desktop} />
      </section>

      <section className="settings-admin-section">
        <h3 className="settings-admin-section-heading">AI ומודלים</h3>
        <SettingsAiPanel {...ai} />
        <SettingsPipelinePanel {...pipeline} />
      </section>

      <section className="settings-admin-section">
        <h3 className="settings-admin-section-heading">ענן (R2)</h3>
        <SettingsCloudPanel {...cloud} />
      </section>
    </div>
  );
}
