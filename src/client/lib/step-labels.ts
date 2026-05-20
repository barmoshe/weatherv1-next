/**
 * Canonical Hebrew labels for pipeline `failed_step` values. Single source so
 * the badge in JobRow, the chip in ErrorBanner, and the row in JobTimeline
 * all agree on copy when a job fails at the same step.
 */
export const STEP_LABELS_HE: Record<string, string> = {
  transcribe: "תמלול",
  scene_planner: "תכנון סצינות",
  picker: "בחירת קליפים",
  render: "רינדור",
  restore: "טעינה",
  login: "התחברות",
  catalog: "קטלוג",
};

export function stepLabelHe(step?: string | null): string | undefined {
  if (!step) return undefined;
  return STEP_LABELS_HE[step] ?? step;
}
