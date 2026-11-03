// "Is there a newer zip?" — the page compares its version with the one the
// release workflow publishes next to the zip. No auto-update: the editor
// downloads the new zip and replaces index.html.

import type { DesktopUpdateState } from "@/shared/desktop";

declare const __WEATHERV1_VERSION__: string;

export const VERSION_URL =
  "https://weatherv1-r2-gateway.barprojectsandbuilds.workers.dev/downloads/web/latest/version.json";
export const DOWNLOAD_PAGE = "https://weatherv1-download.pages.dev";

let state: DesktopUpdateState = { status: "idle" };
let checked = false;

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return false;
}

export function updateState(): DesktopUpdateState {
  return state;
}

export async function checkForUpdate(): Promise<DesktopUpdateState> {
  if (checked) return state;
  checked = true;
  try {
    const res = await fetch(VERSION_URL, { cache: "no-store" });
    if (!res.ok) return state;
    const { version } = (await res.json()) as { version?: string };
    if (version && newer(version, __WEATHERV1_VERSION__)) {
      state = { status: "available", detail: `גרסה ${version} זמינה בדף ההורדה` };
    } else {
      state = { status: "idle" };
    }
  } catch {
    state = { status: "unavailable", detail: "אין חיבור לבדיקת עדכונים" };
  }
  return state;
}
