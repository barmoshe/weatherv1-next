// Runs before any app module is evaluated: the UI reads `window.desktop`
// once, at import time (src/client/lib/desktop.ts), and every `/api` fetch
// must already be routed in-page.
import { installApiRouter } from "../api/router";
import { webDesktopBridge } from "../runtime/desktop-bridge";
import { SESSION_TOKEN } from "../runtime/settings";

window.desktop = webDesktopBridge;
installApiRouter(SESSION_TOKEN);
