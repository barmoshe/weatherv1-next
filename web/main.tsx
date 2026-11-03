// Entry of the browser build. Order matters: Node globals first, then the
// desktop bridge and the in-page API (boot/early), then the same React tree
// the Next page renders.

import "./shims/process";
import "./boot/early";
import "@/app/globals.css";
import "./web.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import Home from "@/app/page";
import { Gate } from "./boot/Gate";
import { loadSettings } from "./runtime/settings";
import { flush, hasPendingWrites, mountFolder } from "./runtime/vfs";
import { resetRuntimeConfigForTests } from "@/server/runtime/config";
import { resetAssetSourceForTests } from "@/server/assets/source";
import { startWorker } from "@/server/jobs/worker";

// Losing the last debounced write would lose a catalog or job change.
window.addEventListener("beforeunload", (e) => {
  if (!hasPendingWrites()) return;
  void flush();
  e.preventDefault();
});

async function mount(): Promise<void> {
  await loadSettings();
  await mountFolder();
  resetRuntimeConfigForTests();
  resetAssetSourceForTests();
  startWorker();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Gate onMount={mount}>
      <Home />
    </Gate>
  </StrictMode>,
);
