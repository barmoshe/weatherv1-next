# Premiere Plugin Path — Research

Companion to [TASK.md](TASK.md) and [PLAN.md](PLAN.md). Treats the **CEP/UXP panel** alternative — ruled out for v1 in PLAN.md — as a real v2/v3 path and answers what it would take to ship.

## Context

The v1 plan ships **FCP7 XML + SRT file handoff** for editors to import. PLAN.md flagged a CEP/UXP panel as a richer follow-up that could:

- Browse completed WeatherV1 jobs from inside Premiere.
- Pull a selected plan bundle and **programmatically** build a 1080×1920 9:16 30 fps sequence with voiceover, Hebrew scene markers, and per-clip notes — without round-tripping through a file.
- Re-pull / re-build a sequence after the editor re-runs the planner.

This doc resolves the open questions a plugin build would face.

## Recommendation: **CEP now, plan UXP migration in 12 months**

Adobe shipped UXP for Premiere with Premiere 25.0 (late 2024) and is the strategic platform. Their stated policy (Premiere 25.6): "CEP extensions have been superseded by UXP… we will support both for a calendar year, after which we will remove support for CEP." That points to **CEP EOL around late 2026 / early 2027** for Premiere. CEP 12 is the last major release; security fixes only.

For the workload here (build a sequence, insert clips, set markers/notes), the **ExtendScript/CEP** surface is mature and complete. UXP for Premiere's `@adobe/premierepro` covers sequences/tracks/clips/markers/projectItems, but the API is still being filled out and has confirmed installation-time friction (see "Local HTTP" below). CEP is the lower-risk path for an internal tool that needs to ship now; the per-clip JSX logic is essentially identical to what `@adobe/premierepro` will require later — just hosted differently.

## Sequence building — ExtendScript / CEP sketch

All on `app.project` and `Sequence`:

```javascript
// Import voiceover + source clips into the project bin
app.project.importFiles(
  [voPath, ...clipPaths],
  true,
  app.project.getInsertionBin(),
  false
);

// Create the sequence, force 1080x1920 @ 30
var seq = app.project.createNewSequence("Forecast " + jobId, newGuid());
var s = seq.getSettings();
s.videoFrameWidth = 1080;
s.videoFrameHeight = 1920;
s.videoFrameRate = new Time();
s.videoFrameRate.seconds = 1 / 30;
seq.setSettings(s);

// Place clips (per ResolvedPick)
var vTrack = seq.videoTracks[0];
var aTrack = seq.audioTracks[0];
projectItem.setInPoint(videoStart, 4);
projectItem.setOutPoint(videoEnd, 4);
vTrack.overwriteClip(projectItem, audioStart); // timeline position
aTrack.overwriteClip(voProjectItem, 0);

// Markers — Hebrew scene titles + narration in the comment
var m = seq.markers.createMarker(sceneStartSec);
m.name = scene.title_he;
m.comments = scene.narration;
m.end = sceneEndSec;

// Per-clip "Notes" column — picker reasoning
// Notes is XMP dc:description, not a first-class field
projectItem.setMetadata(xmpStringWithPickerReason);
```

Refs: [Sequence object](https://ppro-scripting.docsforadobe.dev/sequence/sequence/), [PProPanel sample](https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PPRO/Premiere.jsx), [Premiere ExtendScript guide](https://ppro-scripting.docsforadobe.dev/).

## Local HTTP from the panel → WeatherV1 API

The panel needs to call the WeatherV1 desktop API. Mapping what's available today (`src/app/api/...`):

| What the panel needs | Existing route | Auth |
| --- | --- | --- |
| List completed jobs | `GET /api/jobs` ([`src/app/api/jobs/route.ts:15`](../../../src/app/api/jobs/route.ts)) | Returns shape `{ success, jobs: [{ job_id, status, audio_filename, … }] }` |
| Fetch a plan bundle | `GET /api/plan/[jobId]` ([`src/app/api/plan/[jobId]/route.ts:4`](../../../src/app/api/plan/[jobId]/route.ts)) | `{ success, plan }` |
| Catalog entries | `GET /api/catalog` ([`src/app/api/catalog/route.ts:6`](../../../src/app/api/catalog/route.ts)) | Returns relative `filename` only — see gap below |
| Stream a video file | `GET /videos/[filename]` | Gated via middleware |

All routes covered by middleware ([`src/proxy.ts:28-49`](../../../src/proxy.ts)) which checks `x-weather-desktop-token` (`DESKTOP_AUTH_HEADER`, [`src/server/runtime/auth.ts:7`](../../../src/server/runtime/auth.ts)) sourced from `DESKTOP_SESSION_TOKEN` env, then falls back to the `weather_editor_session` cookie.

**CEP fits the auth model naturally.** A CEP panel is a Chromium webview that can `fetch("http://127.0.0.1:3765/api/...")` with custom headers. The plugin reads the desktop token from a small one-time setup screen (paste-once, store in CEP's `localStorage`). Same-origin localhost calls, no CORS preflight headaches, no mixed-content issues. CSP is configured in `CSXS/manifest.xml`.

**UXP caveats — the reason CEP wins for v2:**
- `requiredPermissions.network.domains` must be declared in `manifest.json`.
- **IP literals are flaky/blocked** — confirmed reports that `http://127.0.0.1:3765` fails permission checks ([forum](https://forums.creativeclouddeveloper.com/t/uxp-manifest-network-permission-denied-for-fetch-despite-domains-all/10557)). Use `http://localhost:3765` instead — but WeatherV1's child server contract is `127.0.0.1` (CLAUDE.md: "Do not substitute `localhost` for `127.0.0.1`… macOS may resolve to `::1`"). Need a server-side change to accept both, OR resolution happens client-side in the panel.
- **Installed-plugin cold-start regression (Premiere 26.2)**: a sideloaded `.ccx` loses network permission until UDT loads a dev version in the same session ([forum thread](https://forums.creativeclouddeveloper.com/t/installed-uxp-plugin-only-gets-network-permission-after-udt-loads-dev-version-in-same-session-premiere-26-2/11881)). Shipping blocker until Adobe fixes it.

## Auth-token plumbing — implementation gap

`DESKTOP_SESSION_TOKEN` is injected by the Electron main process and not exposed to anything outside the Electron sandbox today. A separate Premiere plugin runs in a separate process and cannot read `safeStorage`. Options:

1. **One-time paste**: the WeatherV1 Settings panel surfaces the current token; the editor pastes it into the Premiere panel on first launch. Simple, no new IPC. **Recommended.**
2. **Loopback handshake**: add `POST /api/internal/issue-plugin-token` (exempt from desktop auth, only callable from `127.0.0.1`, returns a derived token after the user clicks "Approve" in a WeatherV1 popup). More work, better UX.

## Source clip width/height — same gap as v1

`GET /api/catalog` returns relative `filename` only, not absolute paths or `width`/`height` (see the [PLAN.md "Source clip width/height" gap](PLAN.md#source-clip-widthheight--open-gap-to-close-in-implementation)). The plugin will need either:

- A probe-at-export helper on the server side (same recommendation as v1), or
- The catalog schema extension so dimensions ride along with each catalog entry.

Whichever way v1 solves it, v2 reuses.

## Distribution & signing — five internal editors

- Package as **ZXP** with Adobe's `ZXPSignCmd` and a **self-signed cert** (free).
- Editors install via [Anastasiy's Extension Manager](https://install.anastasiy.com/) or ZXPInstaller (drag-drop). No Adobe Exchange, no Adobe-issued cert.
- **Known active issue (2024–2025)**: ZXPs signed on macOS install but render blank on Windows and vice-versa. **Sign on each target OS** ([Adobe bug thread](https://community.adobe.com/t5/exchange-bugs/cross-platform-zxp-signing-compatibility-known-issue-and-workaround-2024/idi-p/14961412)). For five editors, build two ZXPs in CI — the repo already has a Windows runner ([`.github/workflows/desktop.yml`](../../../.github/workflows/desktop.yml)).
- UXP equivalent is `.ccx` via UXP Developer Tool or Creative Cloud Desktop sideload — inherits the cold-start permission bug above.

## Effort estimate — single dev, plan bundle + FCP7-XML already done

**~4–6 working days for a minimal CEP panel.**

| Day | Work |
| --- | --- |
| 1 | CEP scaffold (manifest, debug mode, React panel chrome), token paste UI, `/api/jobs` list. |
| 2 | `CSInterface.evalScript` bridge, `importFiles` + `createNewSequence` + `setSettings()` for 1080×1920@30. |
| 3 | `insertClip` loop from plan bundle timeline, voiceover on A1, source in/out trims. |
| 4 | Sequence markers (Hebrew name + narration comment), XMP Notes on project items for `picker_reason`, RTL CSS for the panel UI. |
| 5–6 | ZXP signing on mac + win, install docs, two rounds of editor feedback. |

**Where time actually goes:** (a) the ExtendScript ↔ panel JSON bridge (string-only `evalScript`, async wrapping); (b) timecode/`Time` object arithmetic at 30 fps; (c) XMP for the Notes column (it's not first-class); (d) Hebrew RTL inside the CEP CEF webview; (e) the mac↔win signing dance.

**Migration cost later (CEP → UXP):** ~3–4 days *once* Adobe ships the installed-plugin network-permission fix. Re-host the same JSX onto `@adobe/premierepro` (Promise-based), swap panel chrome, fix the localhost↔127.0.0.1 mismatch.

## Open implementation gaps (carry into the v2 task)

1. **Token plumbing** — decide between one-time paste vs. loopback handshake (above).
2. **Catalog absolute paths + dimensions** — the plugin needs full paths and `width`/`height`. The probe-at-export helper from v1 is reusable on the server side; or extend `/api/catalog` to embed both fields.
3. **Notes column** is not first-class; XMP `dc:description` is the only documented route. Build a tiny XMP-string helper.
4. **CEP CSP** — declare `connect-src http://127.0.0.1:3765` in `CSXS/manifest.xml` so `fetch` is allowed.
5. **Hebrew RTL in the panel chrome** — `dir="rtl"` on the React root plus an RTL-aware font stack.

## Forward path

When Adobe stabilises UXP installed-plugin permissions AND announces a CEP EOL date, port the JSX core to `@adobe/premierepro` and ship a `.ccx`. The plan-bundle → timeline mapping written for v1 (FCP7 XML) and v2 (CEP panel) should already be in a shared TS module by then; the UXP build is a re-host, not a rewrite.

## Non-goals (still)

- No round-trip from Premiere back into WeatherV1.
- No Premiere render automation.
- No replacement for the FCP7 XML handoff — the plugin is **additive**; editors who don't install it use the v1 file flow.

## Primary sources

- [Premiere UXP API portal](https://developer.adobe.com/premiere-pro/uxp/)
- [Premiere UXP API reference](https://developer.adobe.com/premiere-pro/uxp/ppro_reference/)
- [Adobe Tech Blog — CEP/UXP timeline](https://medium.com/adobetech/updates-for-creative-cloud-desktop-extensibility-0dd5c663563e)
- [Premiere Pro Scripting Guide (ExtendScript)](https://ppro-scripting.docsforadobe.dev/)
- [Sequence object reference](https://ppro-scripting.docsforadobe.dev/sequence/sequence/)
- [PProPanel CEP sample](https://github.com/Adobe-CEP/Samples/blob/master/PProPanel/jsx/PPRO/Premiere.jsx)
- [UXP manifest network-permission bugs (localhost/IP)](https://forums.creativeclouddeveloper.com/t/uxp-manifest-network-permission-denied-for-fetch-despite-domains-all/10557)
- [Installed UXP cold-start permission bug, Premiere 26.2](https://forums.creativeclouddeveloper.com/t/installed-uxp-plugin-only-gets-network-permission-after-udt-loads-dev-version-in-same-session-premiere-26-2/11881)
- [Cross-platform ZXP signing issue 2024+](https://community.adobe.com/t5/exchange-bugs/cross-platform-zxp-signing-compatibility-known-issue-and-workaround-2024/idi-p/14961412)
- [Anastasiy's Extension Manager](https://install.anastasiy.com/)
