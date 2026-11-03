"use client";

// First screen of the browser build: checks the browser, then gets the
// catalog folder (picked once, re-allowed with one click each session) and
// loads it before the studio mounts.

import { useEffect, useState, type ReactNode } from "react";
import { detectCapabilities, missingRequired, type Capabilities } from "./capabilities";
import { ensurePermission, pickFolder, savedHandle, setRoot } from "../runtime/folder";
import { httpFolder } from "../runtime/http-folder";

type Phase = "checking" | "unsupported" | "choose" | "resume" | "loading" | "ready" | "error";

export function Gate({ onMount, children }: { onMount: () => Promise<void>; children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>("checking");
  const [caps, setCaps] = useState<Capabilities | null>(null);
  const [saved, setSaved] = useState<FileSystemDirectoryHandle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const c = await detectCapabilities();
      setCaps(c);
      if (missingRequired(c).length) return setPhase("unsupported");
      const testFolder = new URLSearchParams(window.location.search).get("testFolder");
      if (testFolder) return void open(await httpFolder(testFolder));
      const handle = await savedHandle();
      if (handle) {
        setSaved(handle);
        setPhase("resume");
      } else {
        setPhase("choose");
      }
    })();
  }, []);

  const open = async (handle: FileSystemDirectoryHandle) => {
    setError(null);
    if (!(await ensurePermission(handle))) {
      setError("בלי אישור גישה לתיקייה האפליקציה לא יכולה לעבוד. נסה שוב ובחר ״אפשר״.");
      return;
    }
    setPhase("loading");
    try {
      setRoot(handle);
      await onMount();
      setPhase("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  };

  const choose = async () => {
    try {
      await open(await pickFolder());
    } catch {
      // picker cancelled
    }
  };

  if (phase === "ready") return <>{children}</>;

  return (
    <main className="container web-gate" dir="rtl">
      <section className="card web-gate__card">
        <h1 className="web-gate__title">
          <span className="brand-mark">V1</span> מחולל תחזית
        </h1>
        {phase === "checking" && <p>בודק את הדפדפן…</p>}
        {phase === "unsupported" && caps && (
          <>
            <p>הדפדפן הזה לא תומך ב: {missingRequired(caps).join(", ")}.</p>
            <p>פתח את index.html ב-Google Chrome או ב-Microsoft Edge (גרסה עדכנית, במחשב).</p>
          </>
        )}
        {phase === "choose" && (
          <>
            <p>
              בחר את תיקיית הספרייה: התיקייה <b dir="ltr">weather</b> שמכילה את <code dir="ltr">notouch!</code>,{" "}
              <code dir="ltr">videos</code> ו-<code dir="ltr">music</code>. התחזיות המוכנות יישמרו בה, בתיקייה{" "}
              <code dir="ltr">outputs</code>.
            </p>
            <button type="button" className="btn btn--primary" onClick={() => void choose()}>
              בחירת תיקייה
            </button>
          </>
        )}
        {phase === "resume" && saved && (
          <>
            <p>
              הספרייה: <b dir="ltr">{saved.name}</b>
            </p>
            <div className="web-gate__actions">
              <button type="button" className="btn btn--primary" onClick={() => void open(saved)}>
                המשך
              </button>
              <button type="button" className="btn btn--ghost" onClick={() => void choose()}>
                תיקייה אחרת
              </button>
            </div>
          </>
        )}
        {phase === "loading" && <p>טוען את הספרייה…</p>}
        {error && <p className="web-gate__error">{error}</p>}
        {caps && !caps.webgpu && phase !== "unsupported" && (
          <p className="settings-hint">אין במחשב הזה האצת GPU בדפדפן, ולכן התמלול יהיה איטי יותר.</p>
        )}
      </section>
    </main>
  );
}
