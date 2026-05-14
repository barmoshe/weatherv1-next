"use client";

type Props = {
  title: string;
  subtitle?: string;
  /** `sync` sits above the R2 login gate (z-index 210 vs 200). */
  layer?: "default" | "sync";
};

export function AppBootstrapShell({ title, subtitle, layer = "default" }: Props) {
  const rootClass = ["app-bootstrap", layer === "sync" ? "app-bootstrap--sync" : ""].filter(Boolean).join(" ");
  return (
    <div
      className={rootClass}
      dir="rtl"
      lang="he"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <div className="app-bootstrap__backdrop" aria-hidden="true" />
      <div className="app-bootstrap__card">
        <div className="app-bootstrap__spinner" aria-hidden="true" />
        <p className="app-bootstrap__title">{title}</p>
        {subtitle ? <p className="app-bootstrap__subtitle">{subtitle}</p> : null}
      </div>
    </div>
  );
}
