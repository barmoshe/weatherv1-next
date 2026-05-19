"use client";

interface SettingsPipelinePanelProps {
  pipeline: "ver1" | "ver2";
  saving: boolean;
  onPipelineChange: (next: "ver1" | "ver2") => void;
}

export function SettingsPipelinePanel({
  pipeline,
  saving,
  onPipelineChange,
}: SettingsPipelinePanelProps) {
  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <h3 id="settings-pipeline-title">צינור תכנון</h3>
      </div>
      <fieldset className="settings-field" aria-labelledby="settings-pipeline-title">
        <legend className="sr-only">בחירת צינור התכנון של /api/plan</legend>
        <label className="settings-radio">
          <input
            type="radio"
            name="plan-pipeline"
            value="ver1"
            checked={pipeline === "ver1"}
            disabled={saving}
            onChange={() => onPipelineChange("ver1")}
          />
          <span className="settings-radio-label">
            ver1 — קלאסי (validator)
          </span>
        </label>
        <label className="settings-radio">
          <input
            type="radio"
            name="plan-pipeline"
            value="ver2"
            checked={pipeline === "ver2"}
            disabled={saving}
            onChange={() => onPipelineChange("ver2")}
          />
          <span className="settings-radio-label">
            ver2 — בחירה דינמית (retrieve-then-pick)
          </span>
        </label>
      </fieldset>
      <p className="settings-hint">
        ver1 הוא ברירת המחדל — תכנון סצנות, picker מלא ו־validator קבוע. ver2 מצמצם
        ל־2 קריאות LLM בלבד עם רשימה ממוקדת של 15 קליפים לכל סצנה, ללא validator
        ובאחריות מלאה של המודל. שינוי דורש איתחול של שרת המשנה.
      </p>
    </section>
  );
}
