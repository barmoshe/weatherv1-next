"use client";
import type { StudioPhase, TileState } from "./StudioPanel";

interface PlanData {
  timeline: Record<string, unknown>[];
  scenes: unknown[];
  validator: unknown;
}

interface RenderCardProps {
  phase: StudioPhase;
  tileState: TileState;
  planData: PlanData | null;
  onRenderStart: () => void;
}

const STATUS_LABELS: Record<TileState, string> = {
  "is-skeleton": "ממתין",
  waiting: "בתור",
  active: "מעבד",
  completed: "הושלם",
  failed: "נכשל",
};

function RenderGlyph() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="2" y="5" width="14" height="14" rx="2" ry="2" />
      <path d="M17 9l6 3-6 3V9z" />
    </svg>
  );
}

function RerenderGlyph() {
  return (
    <svg className="icon" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9 9 0 0 0 6.64-2.87L21 16" />
      <path d="M21 21v-5h-5" />
    </svg>
  );
}

export function RenderCard({ phase, tileState, planData, onRenderStart }: RenderCardProps) {
  const isRendering = phase === "rendering";
  const isDone = phase === "done";
  const canRender = (phase === "planned" || phase === "done") && !!planData;

  return (
    <section
      className={`tile step ${tileState}`}
      id="step-edit"
      data-area="render"
      data-waits-for="ציר הזמן"
      data-expanded="false"
      aria-label="שלב 5 — רינדור"
    >
      <header className="tile-header">
        <svg className="icon tile-icon icon--lg" viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.78 1.01 1.34 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span className="step-title">רינדור</span>
        <span className="status-pill">{STATUS_LABELS[tileState]}</span>
      </header>
      <div className="tile-body">
        <div className="waiting-state" aria-hidden="true">
          <div className="waiting-glyph">
            <svg className="icon" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.36.78 1.01 1.34 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
          </div>
          <span className="waiting-badge">
            <svg className="icon" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
            ממתין ל<span className="waiting-label-text"></span>
          </span>
          <div className="waiting-track"></div>
        </div>
        <div className="step-content" id="edit-result">
          {isRendering && (
            <div className="render-progress">
              <div className="spinner" aria-hidden="true" />
              <span>מרנדר וידאו…</span>
            </div>
          )}
          {canRender && !isRendering && (
            <button
              className="btn btn--primary render-btn"
              type="button"
              onClick={onRenderStart}
            >
              {isDone ? (
                <>
                  <RerenderGlyph />
                  רנדר מחדש
                </>
              ) : (
                <>
                  <RenderGlyph />
                  רנדר
                </>
              )}
            </button>
          )}
          {tileState === "is-skeleton" && (
            <div className="skeleton-block" aria-hidden="true" />
          )}
        </div>
      </div>
    </section>
  );
}
