# Electron + UX/UI Research

Research notes for the desktop port described in `ELECTRON_DESKTOP_PLAN.md`.
Focus: how to build, style, and ship an Electron shell around the existing
Next.js renderer without compromising security, performance, or native feel.

## Scope

This document only covers the desktop-shell concerns. App-level UI patterns
inside the renderer (component design, state, accessibility) still live in the
existing `src/client/components/` tree and follow the project's normal Next.js
conventions.

## 1. Process Model And Security

### 1.1 Three-Process Mental Model

- **Main process** — Node-privileged. Owns app lifecycle, windows, menus,
  native dialogs, the managed Next child process, and secure storage. Never
  loads remote untrusted content.
- **Preload script** — Runs before the renderer. Sole place where a typed,
  minimal bridge is exposed to the renderer via `contextBridge`. No business
  logic. No Node primitives leaked.
- **Renderer** — The Next.js app served from `127.0.0.1:<fixed-port>`.
  Treated as untrusted in security posture even though we author it.

### 1.2 Hard Defaults For `BrowserWindow.webPreferences`

These have been the **defaults since Electron 20.0.0**, so this is about *not
regressing* rather than *opting in*. Any PR that flips one of these is a
security review event.

| Setting              | Value   | Why                                                                   |
| -------------------- | ------- | --------------------------------------------------------------------- |
| `contextIsolation`   | `true`  | Required to keep preload globals out of page scripts.                 |
| `nodeIntegration`    | `false` | Renderer must not see `require`, `process`, `Buffer`, etc.            |
| `sandbox`            | `true`  | Restricts preload + renderer to Chromium's sandbox.                   |
| `webSecurity`        | `true`  | Keep same-origin policy on. Never disable for "dev convenience".      |
| `allowRunningInsecureContent` | `false` | Loopback origin is `http://`, but content must stay first-party. |
| `experimentalFeatures` | `false` | No surprise Chromium flags.                                         |

Disabling `contextIsolation` (or setting `nodeIntegration: true`) also
disables Chromium's process sandbox for that renderer — they go together.

### 1.3 Boundary Rules

- The preload bridge is the **only** path from renderer → main. No `ipcRenderer`
  is exposed directly; expose **one named method per IPC message** via
  `contextBridge` — only the methods listed in `ELECTRON_DESKTOP_PLAN.md` §10
  are surfaced.
- **IPC is the security boundary.** Treat every message from the renderer
  like an HTTP request from an untrusted client: validate inputs with `zod`
  (already a project dep), authorize the caller, sanitize before use.
- Block navigation away from the loopback origin via
  `webContents.on("will-navigate")` and `setWindowOpenHandler`. External links
  must open in the OS browser via `shell.openExternal` after URL allowlist
  checks.
- Add a strict `Content-Security-Policy` response header from the Next server
  for desktop mode. Suggested baseline:
  `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';`
  `img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self';`
  `font-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'`.
  CSP is the last line of defense against XSS — even if a payload gets
  injected, a strict CSP can keep it from running. **Prefer nonces or hashes
  over `'unsafe-inline'`**; `'unsafe-inline'` on styles here is a pragmatic
  trade-off pending a styled-jsx migration, not the recommendation.
- Pin the loopback origin and reject any other origin in the desktop session
  token guard described in the plan.

### 1.4 Update Posture

- Use `update-electron-app` (wraps `autoUpdater`) for macOS + Windows.
- **macOS**: notarization has been a hard requirement for non-MAS
  distribution since macOS 10.15 (Catalina). Auto-update on macOS refuses
  unsigned bundles, so signing + notarization is not optional in v1.
- **Windows**: Microsoft requires an **EV (extended validation) code-signing
  certificate** for new publishers as of June 2023 to avoid SmartScreen
  warnings on first launch. Standard OV certs still build reputation slowly.
- Show update state in `SettingsModal` (already planned).

## 2. Window Chrome And Native Feel

### 2.1 Title Bar Strategies

| Strategy                  | Pros                                                                 | Cons                                                                 | When To Use |
| ------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------------------- | ----------- |
| Default native chrome     | Zero work. Always correct on every OS.                               | Looks generic. No brand in the bar.                                  | Internal tools, v0. |
| `titleBarStyle: "hidden"` + `titleBarOverlay` (Win/Linux) | Native window controls remain, but title area is yours.              | Need to track overlay color on theme change via `setTitleBarOverlay`. | **Recommended** for v1. |
| `frame: false` (full custom) | Total control.                                                       | You re-implement drag, double-click-to-maximize, snap, accessibility. | Only if branded chrome is a hard requirement. |

For v1 we recommend `titleBarStyle: "hiddenInset"` on macOS (keeps traffic
lights, hides the title text) plus `titleBarOverlay` on Windows. The renderer
gets a CSS-controlled top strip it can paint into.

`titleBarOverlay` is the **Window Controls Overlay (WCO)** web standard
surfaced by Electron. Two consequences for layout:

- DOM elements **cannot occupy the area underneath the OS-drawn window
  controls** — read the overlay rect from `navigator.windowControlsOverlay`
  and leave that region empty.
- The overlay's `color` and `symbolColor` (Windows/Linux) must be updated on
  theme change via `BrowserWindow.setTitleBarOverlay(...)`; they don't
  inherit from CSS.

### 2.2 Drag Regions

- Custom title-bar strips need `-webkit-app-region: drag` on the container and
  `-webkit-app-region: no-drag` on any interactive child (buttons, inputs).
- Drag regions break pointer events inside the region, so place no clickable
  controls in the drag area without `no-drag`.
- Drag regions can also swallow **text selection** events — never put
  selectable text inside a drag region. The title-bar strip should not host
  user-copyable strings.
- On some platforms the drag region is treated as non-client frame, so
  custom **context menus must not be attached to draggable areas** (they
  collide with the OS window menu).

### 2.3 macOS-Specific Polish

- `vibrancy: "sidebar" | "under-window" | "hud"` for translucent panels.
  Combine with `visualEffectState: "active"` to keep the effect when the window
  is unfocused.
- `trafficLightPosition` to align the close/minimize/maximize buttons with the
  custom title bar.
- Respect "Reduce Transparency" — `nativeTheme.shouldUseInvertedColorScheme`
  and `systemPreferences.getAccentColor()` give you the right cues.

### 2.4 Windows / Linux Polish

- Set `backgroundMaterial: "mica" | "acrylic" | "tabbed"` (or
  `win.setBackgroundMaterial(...)` at runtime) on Windows 11 for a
  modern translucent backdrop. **Requires Windows 11 22H2+.** On Win10 fall
  back to a solid `backgroundColor` matching the theme.
- Prefer **Mica for the main window**: it samples the desktop wallpaper once
  and is effectively free at runtime — well-suited to a long-lived studio
  window.
- Use **Acrylic only for transient surfaces** (command palettes, popovers,
  context menus). It does a real-time Gaussian blur of the screen behind the
  window and has a non-trivial GPU cost; leaving it on the main window is
  wasteful.
- Known regressions to test against: frameless Win11 windows have had
  rounded-corner and material-flicker issues across maximize/restore in
  recent Electron versions. Test the maximize / restore / snap cycle on
  Win11 before each release.
- Match the renderer background color to `BrowserWindow`'s `backgroundColor`
  to prevent white-flash on cold start (see §7).

## 3. Theming

### 3.1 Source Of Truth

- The OS is the source of truth. Use `nativeTheme.shouldUseDarkColors` in main,
  forward changes through the preload bridge, and let the renderer apply a
  `data-theme="dark"` attribute on `<html>`.
- Watch `nativeTheme.on("updated", ...)` and re-emit. Don't poll.
- For an explicit user override, set
  `nativeTheme.themeSource = "system" | "light" | "dark"` in main —
  `prefers-color-scheme` and `shouldUseDarkColors` will both follow it
  automatically, no manual fan-out needed.
- Persist the override in Electron-owned config, **not `localStorage`**, so
  it survives port changes and uninstall/reinstall on the same machine.
- **Known issue**: Electron v39 shipped a regression where
  `shouldUseDarkColors` and `window.matchMedia('(prefers-color-scheme: dark)')`
  could be reported incorrectly at runtime. Pin Electron to a known-good
  range and add a smoke test that toggles `themeSource` and asserts the
  renderer attribute updates.

### 3.2 Token Strategy

- Define semantic CSS custom properties (`--bg`, `--bg-elevated`, `--fg`,
  `--fg-muted`, `--border`, `--accent`, `--danger`, …) in a single root file.
- Theme swap = re-binding tokens under `[data-theme="dark"]`. Components never
  reach for raw color values.
- Mirror OS accent color where it makes sense (selection, focus rings) via
  `systemPreferences.getAccentColor()`.

### 3.3 First-Paint Flash

The canonical anti-flash pattern combines **two** mechanisms:

```js
const win = new BrowserWindow({
  show: false,
  backgroundColor: "#0b0b0b", // match resolved theme
  // ...
});
win.once("ready-to-show", () => win.show());
```

- `show: false` + `ready-to-show` defers first paint until content is
  rendered, so users never see an empty Chromium frame.
- `backgroundColor` paints the native window surface immediately and matches
  what the renderer will paint, so the moment the window appears it is
  already the right color.
- Inject the resolved theme into the HTML before hydration. With the Next
  App Router, set `data-theme` on `<html>` in the root layout using a value
  read from a desktop-only header that the Electron main process adds to
  the initial request (or via a `cookies()` read on first visit).
- On theme change at runtime, use `win.setBackgroundColor(newColor)` — it
  swaps the native color with no window recreation and no flash.
- **Escape hatch**: if `ready-to-show` arrives too late (e.g., the studio
  performs heavy initial fetches), show the window immediately with the
  tuned `backgroundColor` and a renderer-side skeleton. Better a styled
  skeleton than a frozen white rectangle.

## 4. Styling Approach Inside The Renderer

The Next.js project today is plain CSS-in-JSX + module styles. The desktop port
should not force a framework rewrite. Recommendations, in order of preference:

1. **Keep the current styling system.** Add a small `desktop.css` layer that
   only activates when `<html data-runtime="desktop">` is present. Use it for
   drag regions, title-bar height, and vibrancy-aware backgrounds.
2. **If we adopt a utility framework**, prefer **Tailwind CSS v4**:
   - CSS-first config via the `@theme` directive (no `tailwind.config.js`),
     which composes cleanly with our CSS-custom-property token strategy.
   - ~5× faster full builds, ~100× faster incremental; production CSS is
     roughly 70% smaller than v3 (typical Next.js bundle: 6–12 KB gzipped
     vs. 20–30 KB on v3).
   - Wire to Next 16 via the `@tailwindcss/postcss` bridge and the `@source`
     directive so JSX files are scanned correctly.
   - Avoid CSS-in-JS runtimes (Emotion, styled-components) — they fight
     React Server Components and add bundle weight.
3. **For headless primitives** (dialog, menu, dropdown, tooltip):
   - **Radix UI** has slowed since the WorkOS acquisition; some primitives
     are now thinly maintained.
   - **Base UI** (maintained by the MUI team) is the more actively
     developed primitives layer in 2026 and is the recommended choice for
     new desktop UI work here.
   - `shadcn/ui` supports both Radix and Base UI as primitive layers as of
     2026, so adopting shadcn does not lock us into a single primitive.
   - **Recommendation**: prefer Base UI for new components; keep Radix only
     where existing code already uses it.
   - Avoid heavy component kits (MUI, Chakra, AntD) — they ship a lot of
     CSS, fight tokens, and are tuned for web rather than desktop density.

### 4.1 Desktop Density

- Native desktop UIs are denser than typical web UIs. Reduce default spacing
  scale by ~15–25% under `data-runtime="desktop"`.
- Use the platform default font stack:
  `-apple-system, "Segoe UI Variable", "Segoe UI", Inter, system-ui, sans-serif`.
  Don't ship Google Fonts in the desktop bundle.
- Hairlines: 1 CSS pixel borders look chunky on hi-DPI Macs. Use
  `1px solid color-mix(in srgb, var(--fg) 12%, transparent)` or
  `0.5px` where supported.

### 4.2 Scrollbars

- macOS hides scrollbars by default; Windows shows them. Style with
  `::-webkit-scrollbar` to a thin overlay that matches the theme, and respect
  `prefers-reduced-motion` for fades.

### 4.3 Focus And Keyboard

- Keep focus rings visible. Desktop users keyboard-navigate more than web
  users.
- Implement `Cmd/Ctrl+,` to open Settings, `Esc` to close modals,
  `Cmd/Ctrl+R` only in dev (block reload in packaged builds to avoid resetting
  in-flight FFmpeg jobs).
- Wire the app menu in main (`Menu.setApplicationMenu`) for copy/paste,
  undo/redo, zoom, devtools (dev only), and updates.

## 5. UX Conventions Specific To Desktop

### 5.1 First-Run Flow

Order matters and is fixed:

1. Choose / create workspace folder (calls `pickWorkspace`).
2. Validate folder layout, offer to create `notouch!/`, `videos/`, `music/`.
3. Prompt for `OPENAI_API_KEY` (required) and `GEMINI_API_KEY` (optional).
4. Verify FFmpeg presence (bundled in packaged builds, PATH in dev).
5. Then, and only then, launch the studio UI.

Each step is a separate screen, not a modal stack. Users can quit at any step
and resume on relaunch.

### 5.2 File Pickers

- Always go through the preload bridge (`pickWorkspace`, `pickAudioFile`,
  `importCatalogVideo`). Never use HTML `<input type="file">` for desktop
  flows — it has no path, no folder picking, and confuses the user about
  "where the file goes".
- Cache the last-used directory under Electron config and pass it as
  `defaultPath`.

### 5.3 Long-Running Jobs

- The renderer already polls job state from `/api/*`. In desktop mode, also:
  - Show progress in the dock badge (macOS) via `app.setBadgeCount`.
  - Show progress in the Windows taskbar and macOS dock icon via
    `BrowserWindow.setProgressBar(0..1)`. Pass `-1` to clear; pass `> 1` for
    an indeterminate bar on Windows (other platforms clamp to 100%).
  - Send a native notification on completion using the HTML5
    `new Notification(...)` API — Electron routes this to the OS native
    notification system, no extra dependency needed.
- On Windows each window has its own progress bar; on macOS/Linux there is
  only one for the whole app. With one window in v1, both behaviors collapse
  to the same UX — plan around that.
- Don't block the renderer; never use `alert/confirm/prompt` — they freeze
  Chromium. Use in-app modals.

### 5.4 Errors

- Permission, missing FFmpeg, bad workspace, and expired API keys are the
  common failure modes. Each should map to a single named error in Settings
  with a one-click recovery action (re-pick workspace, re-enter key, locate
  FFmpeg).
- Never surface raw stderr to the user. Log it; show a friendly message and a
  "copy diagnostics" button.

### 5.5 Quit Behavior

- macOS: clicking the red traffic light hides the window, but the app keeps
  running so in-flight renders finish. `Cmd+Q` quits, but if jobs are running,
  prompt before terminating the Next child process.
- Windows/Linux: closing the last window quits. Same in-flight-job prompt.

## 6. Performance

- Cold-start budget: under 2.5s to interactive on a 2020-era laptop. Achieved
  by:
  - Showing the `BrowserWindow` with the right `backgroundColor` immediately
    and only loading the renderer URL after the local Next server reports
    healthy on the internal health route.
  - `ready-to-show` event to defer first paint until the page has content.
- Memory: each `BrowserWindow` is its own Chromium tab. Keep window count to
  one in v1. The Next child process is the bigger footprint; cap concurrent
  FFmpeg workers via existing job-store settings.
- Avoid `webContents.openDevTools()` in packaged builds.

## 7. Accessibility

- Honor `prefers-reduced-motion`, `prefers-contrast`, and
  `prefers-color-scheme` from the renderer.
- All custom title-bar buttons need `aria-label` and a tab stop.
- VoiceOver / Narrator: Electron exposes Chromium accessibility, so
  semantically correct HTML in the renderer is the win. Don't fight it with
  `role="application"`.
- Test with platform tools (`Cmd+F5` for VoiceOver on macOS, Narrator on
  Windows) before each release, not just axe-core in CI.

## 8. Open Questions

- Custom protocol (`app://`) vs. loopback HTTP. The plan picks loopback for
  parity with `next start`. Revisit if we ever need to serve renders with
  large `Range` request volume — the custom protocol has lower overhead.
- Single-instance lock (`app.requestSingleInstanceLock`). Likely yes, to
  prevent two desktop instances racing on the workspace lockfile.
- Whether to expose a tray icon in v1. Probably not — defer to v2.

## 9. References (Read These Before Implementing)

In-repo Next docs (already inspected in handoff):

- `node_modules/next/dist/docs/01-app/03-api-reference/05-config/01-next-config-js/output.md`
- `node_modules/next/dist/docs/01-app/02-guides/custom-server.md`
- `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`

Electron docs (the topic anchors for upstream reading):

- Security tutorial — https://www.electronjs.org/docs/latest/tutorial/security
- Context Isolation — https://www.electronjs.org/docs/latest/tutorial/context-isolation
- Process Sandboxing — https://www.electronjs.org/docs/latest/tutorial/sandbox/
- Custom Title Bar — https://www.electronjs.org/docs/latest/tutorial/custom-title-bar
- Window Customization — https://www.electronjs.org/docs/latest/tutorial/window-customization
- `BrowserWindow` API — https://www.electronjs.org/docs/latest/api/browser-window
- `BaseWindow` options (incl. `backgroundMaterial`) — https://www.electronjs.org/docs/latest/api/structures/base-window-options
- `nativeTheme` API — https://www.electronjs.org/docs/latest/api/native-theme
- Dark Mode tutorial — https://www.electronjs.org/docs/latest/tutorial/dark-mode
- Progress Bars — https://www.electronjs.org/docs/latest/tutorial/progress-bar
- Notifications — https://www.electronjs.org/docs/latest/tutorial/notifications
- Code Signing — https://www.electronjs.org/docs/latest/tutorial/code-signing
- `electron/notarize` — https://github.com/electron/notarize
- Mica feature-request thread — https://github.com/electron/electron/issues/29937
- Frameless Mica/Acrylic fix PR — https://github.com/electron/electron/pull/39708

Background reading (UX + styling, 2025–2026):

- "Electron white screen app startup" (anti-flash pattern) — https://www.christianengvall.se/electron-white-screen-app-startup/
- "Making Electron apps feel native on Mac" — https://dev.to/vadimdemedes/making-electron-apps-feel-native-on-mac-52e8
- Tailwind CSS v4 release notes — https://tailwindcss.com/blog/tailwindcss-v4
- "Electron Desktop Apps with Next.js & Tailwind CSS v4" — https://dev.to/sudhanshuambastha/electron-desktop-apps-with-nextjs-tailwind-css-v4-the-missing-no-bloat-boilerplate-3peh
- "shadcn/ui vs Base UI vs Radix: Components in 2026" — https://www.pkgpulse.com/guides/shadcn-ui-vs-base-ui-vs-radix-components-2026
- "How to Build and Distribute an Electron Desktop App in 2026" — https://dev.to/raxxostudios/how-to-build-and-distribute-an-electron-desktop-app-in-2026-24nk

## 10. Decisions Summary

- Loopback Next server, one fixed port, one window, no remote content.
- `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, strict
  CSP (prefer nonces over `'unsafe-inline'`), navigation allowlist.
- `titleBarStyle: "hiddenInset"` (macOS) + `titleBarOverlay` (Windows);
  respect the Window Controls Overlay rect.
- Mica for the main window on Win11 22H2+; Acrylic only for transient
  surfaces; solid `backgroundColor` everywhere else.
- Theme tokens via CSS custom properties; OS-driven through
  `nativeTheme.themeSource`, with a stored override.
- Anti-flash: `show: false` + `ready-to-show` + `backgroundColor` matching
  the resolved theme; `setBackgroundColor()` on runtime theme swap.
- Keep existing styling stack; add a `desktop.css` layer gated by
  `data-runtime="desktop"`. If a utility framework is adopted, Tailwind v4.
- **Base UI** is the preferred headless primitive layer for new desktop UI;
  Radix kept where already used; no heavy component kit.
- File interactions, theme detection, notifications, and progress all go
  through the preload bridge — one method per IPC message — never raw
  browser APIs.
- Packaging requires real signing + notarization on macOS and EV signing on
  Windows; auto-update via `update-electron-app`.
