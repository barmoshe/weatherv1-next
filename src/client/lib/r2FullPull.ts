"use client";

/** POST `/api/sync/r2/pull` — full match to R2 (catalog, jobs, plans). */
export async function postFullR2Pull(): Promise<void> {
  const r = await fetch("/api/sync/r2/pull", { method: "POST" });
  const data = (await r.json()) as { success?: boolean; error?: string };
  if (!r.ok || !data.success) throw new Error(data.error ?? `HTTP ${r.status}`);
}
