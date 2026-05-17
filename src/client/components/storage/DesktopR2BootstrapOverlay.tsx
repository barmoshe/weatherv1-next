"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { desktop } from "@/client/lib/desktop";
import { useStorageStatus } from "@/client/hooks/useStorageStatus";
import { postFullR2Pull } from "@/client/lib/r2FullPull";
import { AppBootstrapShell } from "./AppBootstrapShell";
import { dispatchRefetchJobs } from "@/client/hooks/useLocalHistory";

/**
 * After cloud credentials + local cache are ready, run one authoritative R2 pull
 * (catalog, jobs, plans) and refresh client caches. Shows above the main shell
 * (and above the login gate) while the pull is in flight.
 */
export function DesktopR2BootstrapOverlay() {
  const { data: storage, refetch } = useStorageStatus();
  const qc = useQueryClient();
  const [pulling, setPulling] = useState(false);
  const prevReadyRef = useRef(false);
  const runTokenRef = useRef(0);

  const readyForPull =
    Boolean(desktop) &&
    storage != null &&
    storage.mode === "cloud" &&
    storage.cloud.ready &&
    storage.localCache.ready;

  useLayoutEffect(() => {
    if (!desktop) return;
    if (!readyForPull) {
      prevReadyRef.current = false;
      return;
    }
    if (prevReadyRef.current) return;
    prevReadyRef.current = true;
    const token = ++runTokenRef.current;
    let cancelled = false;
    setPulling(true);
    void (async () => {
      try {
        await postFullR2Pull();
        if (cancelled || runTokenRef.current !== token) return;
        await Promise.all([
          refetch(),
          qc.invalidateQueries({ queryKey: ["catalog"] }),
          qc.invalidateQueries({ queryKey: ["r2-sync-status"] }),
        ]);
        if (cancelled || runTokenRef.current !== token) return;
        if (typeof window !== "undefined") {
          dispatchRefetchJobs();
        }
      } catch (e) {
        if (!cancelled) {
          console.warn("[r2-bootstrap] full pull failed:", e);
          prevReadyRef.current = false;
        }
      } finally {
        if (!cancelled && runTokenRef.current === token) setPulling(false);
      }
    })();
    return () => {
      cancelled = true;
      runTokenRef.current += 1;
      prevReadyRef.current = false;
    };
  }, [desktop, readyForPull, qc, refetch]);

  if (!desktop || !pulling) return null;
  return (
    <AppBootstrapShell
      layer="sync"
      title="מסנכרן עם הענן…"
      subtitle="מתאימים קטלוג, משימות ותוכניות מ־R2."
    />
  );
}
