"use client";

import type { DesktopStatus } from "./settingsTypes";
import { SecretField } from "./settingsShared";
import { WhisperModelCard } from "./WhisperModelCard";

interface SettingsAiPanelProps {
  desktopStatusKeys: DesktopStatus["keys"];
  whisper?: DesktopStatus["whisper"];
  saving: boolean;
  anthropicKey: string;
  onAnthropicKeyChange: (value: string) => void;
  onClearKey: (provider: "anthropic") => void;
}

export function SettingsAiPanel({
  desktopStatusKeys,
  whisper,
  saving,
  anthropicKey,
  onAnthropicKeyChange,
  onClearKey,
}: SettingsAiPanelProps) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3>מפתח API</h3>
      </div>
      <p className="settings-hint">
        מפתח Claude אחד מפעיל את תכנון הסצנות ובחירת הקליפים. התמלול רץ מקומית ולא צריך מפתח.
      </p>
      <SecretField
        label="ANTHROPIC_API_KEY"
        value={anthropicKey}
        configured={desktopStatusKeys.anthropic_configured}
        placeholder={
          desktopStatusKeys.anthropic_configured ? 'מוגדר — הקלד כדי להחליף' : 'לא מוגדר'
        }
        disabled={saving}
        onValueChange={onAnthropicKeyChange}
        onClear={() => void onClearKey('anthropic')}
      />
      <WhisperModelCard initial={whisper} />
    </section>
  );
}
