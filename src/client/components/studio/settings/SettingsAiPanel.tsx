"use client";

import type { ReactNode } from "react";
import type { LlmProviderPreference } from "@/shared/desktop";
import type { DesktopStatus } from "./settingsTypes";
import { SecretField } from "./settingsShared";

interface SettingsAiPanelProps {
  desktopStatusKeys: DesktopStatus["keys"];
  saving: boolean;
  anthropicKey: string;
  openaiKey: string;
  geminiKey: string;
  onAnthropicKeyChange: (value: string) => void;
  onOpenaiKeyChange: (value: string) => void;
  onGeminiKeyChange: (value: string) => void;
  onClearKey: (provider: "anthropic" | "openai" | "gemini") => void;
  llmProvider: LlmProviderPreference;
  onLlmProviderChange: (pref: LlmProviderPreference) => void;
}

export function SettingsAiPanel({
  desktopStatusKeys,
  saving,
  anthropicKey,
  openaiKey,
  geminiKey,
  onAnthropicKeyChange,
  onOpenaiKeyChange,
  onGeminiKeyChange,
  onClearKey,
  llmProvider,
  onLlmProviderChange,
}: SettingsAiPanelProps) {
  return (
    <>
      <section className="settings-section">
        <div className="settings-section-header">
          <h3>מפתחות API</h3>
        </div>
        <p className="settings-hint">
          הזן לפחות מפתח אחד מבין Anthropic או OpenAI לתכנון. תמלול האודיו רץ דרך OpenAI Whisper בענן, ולכן צריך OPENAI_API_KEY כדי לתמלל.
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
        <SecretField
          label="OPENAI_API_KEY"
          value={openaiKey}
          configured={desktopStatusKeys.openai_configured}
          placeholder={
            desktopStatusKeys.openai_configured ? 'מוגדר — הקלד כדי להחליף' : 'לא מוגדר'
          }
          disabled={saving}
          onValueChange={onOpenaiKeyChange}
          onClear={() => void onClearKey('openai')}
        />
        <SecretField
          label="GEMINI_API_KEY"
          value={geminiKey}
          configured={desktopStatusKeys.gemini_configured}
          placeholder={
            desktopStatusKeys.gemini_configured ? 'מוגדר — הקלד כדי להחליף' : 'אופציונלי'
          }
          disabled={saving}
          onValueChange={onGeminiKeyChange}
          onClear={() => void onClearKey('gemini')}
        />
      </section>

      <section className="settings-section">
        <div className="settings-section-header">
          <h3 id="settings-llm-provider-title">בחירת ספק LLM</h3>
        </div>
        <fieldset className="settings-field" aria-labelledby="settings-llm-provider-title">
          <legend className="sr-only">ספק LLM לתכנון סצנות וקליפים</legend>
          {(
            [
              ["auto", "אוטומטי — לפי המפתחות הקיימים"],
              ["anthropic", <span dir="ltr">Anthropic (Claude)</span>],
              ["openai", <span dir="ltr">OpenAI (GPT-4o)</span>],
            ] as Array<[LlmProviderPreference, ReactNode]>
          ).map(([id, label]) => (
            <label key={id} className="settings-radio">
              <input
                type="radio"
                name="llm-provider"
                value={id}
                checked={llmProvider === id}
                onChange={() => onLlmProviderChange(id)}
              />
              <span className="settings-radio-label">{label}</span>
            </label>
          ))}
        </fieldset>
        <p className="settings-hint">
          תמלול האודיו (Whisper) דורש מפתח OpenAI לפי הלשונית &quot;מפתחות API&quot; למעלה.
        </p>
      </section>
    </>
  );
}
