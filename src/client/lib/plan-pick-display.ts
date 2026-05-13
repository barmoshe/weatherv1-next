/** Prefer LLM editorial copy, then Hebrew validator copy, then technical reason. */
export function pickDisplayReason(p: Record<string, unknown>): string | null {
  const editorial = String(p.picker_reason ?? "").trim();
  if (editorial) return editorial;
  const fallback = String(p.fallback_reason ?? "").trim();
  if (fallback) return fallback;
  const after = String(p.reason ?? "").trim();
  return after || null;
}
