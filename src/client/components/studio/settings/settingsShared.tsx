"use client";

import type { ReactNode } from "react";
import type { DotVariant } from "./settingsTypes";

export function StatusDot({ variant }: { variant: DotVariant }) {
  const cls =
    variant === "ok" ? "is-healthy" : variant === "warn" ? "is-warn" : "is-missing";
  return <span className={`dot ${cls}`} />;
}

interface SettingsStatCardProps {
  label: string;
  value: ReactNode;
  dotVariant: DotVariant;
  hint?: string;
}

export function SettingsStatCard({
  label,
  value,
  dotVariant,
  hint,
}: SettingsStatCardProps) {
  return (
    <div className="settings-stat-card">
      <div className="settings-stat-card-top">
        <StatusDot variant={dotVariant} />
        <span>{label}</span>
      </div>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

interface SecretFieldProps {
  label: string;
  value: string;
  configured: boolean;
  placeholder: string;
  disabled: boolean;
  onValueChange: (value: string) => void;
  onClear: () => void;
}

export function SecretField({
  label,
  value,
  configured,
  placeholder,
  disabled,
  onValueChange,
  onClear,
}: SecretFieldProps) {
  return (
    <label className="settings-field">
      <span>{label}</span>
      <div className="settings-input-group">
        <input
          type="password"
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {configured && (
          <button type="button" className="btn btn--ghost" onClick={onClear} disabled={disabled}>
            נקה
          </button>
        )}
      </div>
    </label>
  );
}

export function shortPath(value: string | null | undefined): string {
  if (!value) return "לא הוגדר";
  if (value.length <= 64) return value;
  return `…${value.slice(-61)}`;
}
