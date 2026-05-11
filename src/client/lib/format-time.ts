export function formatRelativeTime(iso: string | undefined | null): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (!isFinite(then)) return "";
  const diffSec = Math.floor((Date.now() - then) / 1000);
  if (diffSec < 5) return "כעת";
  if (diffSec < 60) return `לפני ${diffSec} שניות`;
  const m = Math.floor(diffSec / 60);
  if (m < 60) return m === 1 ? "לפני דקה" : `לפני ${m} דקות`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "לפני שעה" : `לפני ${h} שעות`;
  const d = Math.floor(h / 24);
  if (d < 30) return d === 1 ? "אתמול" : `לפני ${d} ימים`;
  return new Date(iso).toLocaleDateString("he-IL");
}

export function formatTime(value: number | string | undefined | null, decimals = 0): string {
  const n = Number(value ?? 0);
  const mm = Math.floor(n / 60).toString();
  const seconds = n - Math.floor(n / 60) * 60;
  const padWidth = decimals > 0 ? 3 + decimals : 2;
  const ss = seconds.toFixed(decimals).padStart(padWidth, "0");
  return `${mm}:${ss}`;
}

export function segmentPosterUrl(clip: { segment_id?: unknown; video_id?: unknown } | null | undefined): string {
  const segId = clip?.segment_id;
  if (segId) return `/api/catalog/segment-poster/${encodeURIComponent(String(segId))}`;
  const vidId = clip?.video_id;
  if (vidId) return `/api/catalog/poster/${encodeURIComponent(String(vidId))}`;
  return "";
}

export function formatDuration(sec: number | undefined | null): string {
  if (!sec || !isFinite(sec)) return "";
  const total = Math.round(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}s`;
}
