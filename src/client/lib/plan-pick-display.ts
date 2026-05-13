/** Prefer LLM editorial copy (`picker_reason`), then post-validator `reason`. */
export function pickDisplayReason(p: Record<string, unknown>): string | null {
  const editorial = String(p.picker_reason ?? "").trim();
  if (editorial) return editorial;
  const after = String(p.reason ?? "").trim();
  return after || null;
}
