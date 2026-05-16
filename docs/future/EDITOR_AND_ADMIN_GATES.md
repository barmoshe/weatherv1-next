# Future Task: Editor & Admin Gates (Login + Settings Redesign)

## Goal

Make the app safe for a non-technical broadcast editor. Two role-based
gates land together in one task:

1. **Editor login** at app entry — username `v1editor` + password — so the
   Studio only opens for a recognised editor.
2. **Settings modal redesign** — collapse the current five tabs into two:
   - **Editor (עורך)** — calm, mostly read-only. The only writable
     control is a single OpenAI API key.
   - **Admin (ניהול 🔒)** — password-gated. Re-locks every time the modal
     closes. Holds all the technical panels (catalog diagnostic,
     workspace + FFmpeg paths, all three AI keys + provider radio, R2
     cloud, clear cache, uninstall).

Both gates share one fixed-per-build password mechanism (Argon2id). The
**plaintext passwords** are stored as GitHub Secrets; the build pipeline
hashes them on the fly into a gitignored generated file. Nothing
(plaintext or hash) is ever committed to the repo, and password rotation
happens entirely from the GitHub Secrets UI — no local Node round-trip.

## Research Summary

### Current state (greenfield — no prior commits)

- Settings modal: `src/client/components/studio/SettingsModal.tsx`
  (1–673), five tabs in desktop mode:
  - Overview — `SettingsOverviewPanel.tsx` (1–107) — read-only dashboard.
  - Catalog — `SettingsCatalogPanel.tsx` (1–113) — refresh + missing IDs.
  - Desktop — `SettingsDesktopPanel.tsx` (1–236) — workspace, FFmpeg
    paths, clear cache, uninstall.
  - AI — `SettingsAiPanel.tsx` (1–110) — three `SecretField`s + provider
    radio.
  - Cloud — `SettingsCloudPanel.tsx` (1–256) — R2 credentials + sync.
- Opened from `Masthead.tsx:42–68`. No shared `useSettings` hook; state
  is local to the modal.
- App entry has **no login today**. The only gate is
  `StorageOnboardingGate.tsx` (1–301), which collects R2 Basic-Auth
  credentials — not an identity check. It stays untouched and runs
  *after* the new editor login.
- Desktop perimeter: `src/proxy.ts` enforces `x-weather-desktop-token` on
  `/api/*` for Electron. Web mode short-circuits — no auth at all
  currently.
- `git log --all --grep` for settings/login/password/auth shows nothing.
  Fully greenfield.

### Password storage best practices (web research)

- **Don't ship plaintext or the password in the renderer bundle.** Anyone
  with `app.asar` and a text editor can read it. Verification must
  happen server-side.
- **OWASP recommends Argon2id** (memory-hard, ~19 MiB / 2 iters / 1
  parallel minimum). Resists GPU/ASIC attacks. bcrypt also fine but
  silently truncates at 72 bytes.
- **`crypto.timingSafeEqual`** for constant-time username comparison
  (Argon2 verify is already constant-time internally).
- **Electron `safeStorage`** (DPAPI on Windows, Keychain on macOS) is for
  *runtime user secrets* like the editor session token — not for
  build-time baked secrets.
- **GitHub Secrets** are encrypted at rest with libsodium sealed boxes,
  decrypted only into the per-job runner env, masked in logs, and never
  persisted to the repo — making them the right canonical source for
  the production passwords.
- **Plaintext-in-secrets is safe** when CI immediately transforms the
  value (hash, sign, etc.) and never persists or echoes it. Same shape
  as `WIN_CERT_PASSWORD` already wired in `.github/workflows/desktop.yml:34`.
  The prebuild step must avoid `echo`/`console.log` of either the
  plaintext or the resulting hash — GitHub auto-masks known secrets but
  not values *derived* from them.
- **node-argon2** runs on the standard `ubuntu/macos/windows-latest`
  runners — same native module the runtime uses, so hashes minted in CI
  verify byte-for-byte at runtime.

Useful sources:

- https://www.electronjs.org/docs/latest/api/safe-storage
- https://owasp.org/www-project-cheat-sheets/cheatsheets/Password_Storage_Cheat_Sheet.html
- https://github.com/ranisalt/node-argon2
- https://docs.github.com/en/actions/security-guides/encrypted-secrets
- https://docs.github.com/en/actions/security-guides/security-hardening-for-github-actions#using-secrets

## Proposed Behavior

```mermaid
flowchart TD
  Boot["App start"] --> HasSession{"editor session token?"}
  HasSession -- no --> Login["EditorLoginGate<br/>username v1editor + password"]
  Login --> VerifyEditor["POST /api/auth/editor-login<br/>verifyEditorLogin (Argon2id)"]
  VerifyEditor -- ok --> StoreSession["safeStorage / httpOnly cookie"]
  VerifyEditor -- fail --> Login
  HasSession -- yes --> Studio["Studio shell"]
  StoreSession --> Studio
  Studio --> Settings["Open Settings modal"]
  Settings --> EditorTab["Editor tab (default)"]
  EditorTab --> Cards["Library health · AI Connection (single OpenAI key) ·<br/>Workspace folder (read-only) · App version"]
  Settings --> AdminTabClick["Click Admin tab"]
  AdminTabClick --> Locked["Inline AdminPasswordPrompt"]
  Locked --> VerifyAdmin["POST /api/admin/verify<br/>verifyAdminPassword (Argon2id)"]
  VerifyAdmin -- ok --> Unlocked["Four admin sections"]
  VerifyAdmin -- fail --> Locked
  Settings --> Close["onClose → adminUnlocked = false"]

  subgraph "Build-time hash pipeline"
    Secrets["GitHub Secrets (plaintext)<br/>EDITOR_PASSWORD<br/>ADMIN_PASSWORD"] --> CI["desktop.yml / ci.yml env"]
    Env[".env (gitignored, plaintext)"] --> LocalBuild["npm run dev / build"]
    CI --> Prebuild["scripts/emit-auth-hashes.cjs"]
    LocalBuild --> Prebuild
    Prebuild --> Hash["argon2.hash() at build time"]
    Hash --> Gen["auth-passwords.generated.ts (gitignored)"]
    Gen --> VerifyEditor
    Gen --> VerifyAdmin
  end
```

## Implementation Plan

### Phase 1 — Shared password infrastructure

1. **Add dependency.** `npm install argon2`. Confirm it builds inside
   Electron Forge (native module — `@electron-forge/plugin-auto-unpack-natives`
   is already in `forge.config.cjs`).
2. **`scripts/hash-password.cjs`** *(optional helper)* — prompts for a
   password (no echo), prints the Argon2id hash to stdout. **Not part of
   the rotation flow** anymore — kept only for offline verification /
   debugging (e.g. "does this plaintext hash to that stored value?").
3. **`scripts/emit-auth-hashes.cjs`** — reads `EDITOR_PASSWORD` and
   `ADMIN_PASSWORD` (plaintext) from `process.env`, then for each calls
   `argon2.hash(value, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 })`
   and writes `src/server/runtime/auth-passwords.generated.ts` with
   `export const EDITOR_HASH = "..."; export const ADMIN_HASH = "...";`.
   - In production builds (`NODE_ENV=production` or `CI=true`) hard-fail
     if either env var is missing or empty.
   - In local dev, if both are missing fall back to a banner hash for a
     known dev password (`devdev`) and print a loud warning.
   - Must never `console.log` / `echo` the plaintext or the resulting
     hash. GitHub only masks the secret itself, not derived values.
4. **`src/server/runtime/auth-passwords.ts`** — wraps the generated file.
   - `verifyEditorLogin(username, password)` — `crypto.timingSafeEqual`
     against `"v1editor"`, then `argon2.verify(EDITOR_HASH, password)`.
   - `verifyAdminPassword(password)` — `argon2.verify(ADMIN_HASH, password)`.
5. **Wire build pipeline.**
   - `package.json`: add `"prebuild": "node scripts/emit-auth-hashes.cjs"`.
   - `.gitignore`: add `src/server/runtime/auth-passwords.generated.ts`.
   - `.env.example`: document `EDITOR_PASSWORD` and `ADMIN_PASSWORD`
     (plaintext, populated only in the gitignored local `.env`). Note
     that the hashing happens automatically in the prebuild step.
6. **GitHub Secrets (plaintext).**
   - Repo Settings → Secrets and variables → Actions → add two
     **Repository Secrets**:
     - `EDITOR_PASSWORD` — plaintext editor password.
     - `ADMIN_PASSWORD` — plaintext admin password.
   - Or via CLI:
     ```bash
     gh secret set EDITOR_PASSWORD --app actions
     gh secret set ADMIN_PASSWORD  --app actions
     ```
   - `.github/workflows/desktop.yml` — extend the `env:` block (currently
     at `desktop.yml:28-35`, sibling of `WIN_CERT_PASSWORD`):
     ```yaml
     EDITOR_PASSWORD: ${{ secrets.EDITOR_PASSWORD }}
     ADMIN_PASSWORD:  ${{ secrets.ADMIN_PASSWORD }}
     ```
     These are consumed by the `prebuild` script invoked by
     `npm run build` inside both the "Package unsigned desktop app" and
     "Make release artifacts" steps.
   - `.github/workflows/ci.yml` — pass deliberately non-production
     **test-only** secrets so the gate tests can run end-to-end without
     leaking the real passwords:
     ```yaml
     EDITOR_PASSWORD: ${{ secrets.CI_EDITOR_PASSWORD }}
     ADMIN_PASSWORD:  ${{ secrets.CI_ADMIN_PASSWORD }}
     ```
   - **Rotation flow**: GitHub UI → update secret value → re-run the
     Desktop workflow → new installer ships with the new hash. No local
     hashing, no commit, no code change.

### Phase 2 — Editor login (app entry)

7. **`src/app/api/auth/editor-login/route.ts`** — POST `{ username, password }`
   → `verifyEditorLogin`. On success generates a 32-byte random token,
   stores it in an in-memory `Set` keyed by process, returns `{ ok, token }`
   and sets an `httpOnly`/`sameSite: lax`/`secure` (web) cookie
   `weather_editor_session`.
8. **`src/app/api/auth/sign-out/route.ts`** — POST → revokes the token,
   clears the cookie.
9. **`src/server/runtime/editor-session.ts`** — `issueToken()`,
   `isValidToken(token)`, `revokeToken(token)`.
10. **`src/proxy.ts`** — in web mode require the cookie on `/api/*`
    except `/api/auth/editor-login`. In desktop mode the existing
    desktop-token check stays; the editor cookie becomes an *additional*
    required check so the renderer can't skip login.
11. **Desktop session persistence (IPC).** `electron/main.cjs` — three
    new handlers: `desktop:setEditorSession({ token })` (safeStorage +
    inject into child env), `desktop:getEditorSession`,
    `desktop:clearEditorSession`. `electron/preload.cjs` exposes one
    wrapper per channel via `contextBridge` — never expose
    `ipcRenderer`.
12. **`src/client/components/auth/EditorLoginGate.tsx`** — full-screen
    RTL card mirroring `StorageOnboardingGate.tsx`'s visual language.
    Username field pre-filled and locked to `v1editor`; password field
    with show/hide; Sign in button. On success, store token, render
    `props.children`.
13. **`src/app/page.tsx`** — wrap the Studio shell in `EditorLoginGate`.
    On mount check the session (desktop: IPC; web: probe a small
    `/api/auth/me` route). Render gate or Studio accordingly.
14. **`src/client/components/Masthead.tsx`** — add a "Sign out" entry
    that POSTs `/api/auth/sign-out`, clears the desktop session, and
    reloads.

### Phase 3 — Settings modal redesign (two tabs)

15. **`src/app/api/admin/verify/route.ts`** — POST `{ password }` →
    `verifyAdminPassword`. Returns `{ ok: boolean }`. No token issued —
    gating is per-modal-open, not per-session. Sits behind the editor
    session check.
16. **`src/client/components/studio/settings/EditorTabPanel.tsx`** (new):
    - **Library card** — reuse `useCatalogHealth` data; render one
      friendly line (`Library health: ✓ 124 clips ready` / yellow / red).
      No refresh button, no missing IDs list.
    - **AI Connection card** — reuse the existing `SecretField` for
      *only* `OPENAI_API_KEY`. Label: "OpenAI key (for voice
      transcription)". Status chip green/red. No Anthropic, no Gemini,
      no provider radio.
    - **Workspace card** — read-only path + `Change in Admin →` button
      that switches the active tab to Admin.
    - **App card** — version + "Check for updates" button (reuses
      `desktop.getUpdateState()`).
17. **`src/client/components/studio/settings/AdminTabPanel.tsx`** (new):
    - Internal state `adminUnlocked: boolean`, default false.
    - If locked, render inline `AdminPasswordPrompt` (centered card,
      password field, Unlock button, error on wrong).
    - On successful POST, set `adminUnlocked = true` and render the four
      existing panel components in this order with section headers:
      1. **קטלוג** → `SettingsCatalogPanel`
      2. **דסקטופ וקבצים** → `SettingsDesktopPanel`
      3. **AI ומודלים** → `SettingsAiPanel`
      4. **ענן (R2)** → `SettingsCloudPanel`
    - Small "Lock now" button at the top once unlocked.
18. **`SettingsModal.tsx`** — replace the 5-tab layout with two tabs
    (`editor` default, `admin`). Hold `adminUnlocked` at modal level so
    it resets to `false` in `onClose` (per user choice). Delete
    `SettingsOverviewPanel.tsx` (subsumed by Editor tab). Keep the four
    other panel files intact — they're reused inside the Admin tab
    unchanged.

### Phase 4 — Tests + verification

19. **Unit tests.**
    - `src/test/auth-passwords.test.ts` — `verifyEditorLogin` rejects
      wrong username, wrong password; accepts both right.
      `verifyAdminPassword` accepts right, rejects wrong.
    - `src/test/editor-session.test.ts` — token issue/validate/revoke
      round-trip.
20. **Component tests.**
    - `src/test/editor-login.test.tsx` — gate renders without session,
      right password reveals children, wrong password shows error.
    - `src/test/settings-modal.test.tsx` — Editor tab renders without
      unlock; Admin tab shows prompt; right password reveals four
      sections; close + reopen re-locks Admin.
21. **API route tests.**
    - `src/test/admin-verify-route.test.ts` — right → `{ ok: true }`,
      wrong → `{ ok: false }` (avoid 4xx to not leak enumeration via
      status code).

## Verification

```bash
# Local dev: put plaintext passwords in the gitignored .env
echo 'EDITOR_PASSWORD=...' >> .env
echo 'ADMIN_PASSWORD=...'  >> .env

# Standard verification stack
npx tsc --noEmit
npm test
npm run build                              # prebuild hashes plaintext into the gitignored generated file
npm run electron:dev                       # exercise both gates end-to-end
```

Manual checks:

- **Build hygiene** — grep the built bundle for the plaintext password
  (must not appear) and grep the source tree for either hash (must only
  appear in the gitignored generated file).
- **CI log hygiene** — after a workflow run, open the "Prebuild" /
  build step logs and confirm neither plaintext nor the emitted hash
  appears. GitHub will mask the raw secret automatically, but a derived
  hash is not masked, so the script must stay silent.
- **Editor login** — cold start with no safeStorage entry → gate
  appears; right password lets in; reload keeps you in; quit + relaunch
  keeps you in (safeStorage); sign out returns to gate.
- **Settings Editor tab** — friendly cards, OpenAI key entry persists
  via existing `desktop:saveSettings` IPC, "Change in Admin →" switches
  tabs.
- **Settings Admin tab** — wrong password rejected, right password
  reveals the four sections in order; close + reopen modal re-locks.
- **Web mode (`npm run dev`)** — same flow via cookie.

## Critical files

| Path | Action |
| --- | --- |
| `src/server/runtime/auth-passwords.ts` | new — verify functions |
| `src/server/runtime/auth-passwords.generated.ts` | new, gitignored |
| `src/server/runtime/editor-session.ts` | new — token store |
| `scripts/hash-password.cjs` | new — optional offline-verification helper |
| `scripts/emit-auth-hashes.cjs` | new — hashes plaintext env vars (`EDITOR_PASSWORD`/`ADMIN_PASSWORD`) at build time |
| `src/app/api/auth/editor-login/route.ts` | new |
| `src/app/api/auth/sign-out/route.ts` | new |
| `src/app/api/admin/verify/route.ts` | new |
| `src/client/components/auth/EditorLoginGate.tsx` | new |
| `src/client/components/studio/settings/EditorTabPanel.tsx` | new |
| `src/client/components/studio/settings/AdminTabPanel.tsx` | new |
| `src/client/components/studio/SettingsModal.tsx` | replace tabs |
| `src/client/components/studio/settings/SettingsOverviewPanel.tsx` | delete |
| `src/app/page.tsx` | wrap in `EditorLoginGate` |
| `src/client/components/Masthead.tsx` | add sign-out |
| `src/proxy.ts` | enforce editor session in web mode |
| `electron/main.cjs` | three new session IPC handlers |
| `electron/preload.cjs` | expose three session wrappers |
| `.env.example` | document new env vars |
| `.gitignore` | add generated hash file |
| `package.json` | add `argon2`, `prebuild` script |
| `.github/workflows/desktop.yml` | wire prod secrets (`EDITOR_PASSWORD`, `ADMIN_PASSWORD`) into the `env:` block |
| `.github/workflows/ci.yml` | wire CI-only test secrets (`CI_EDITOR_PASSWORD`, `CI_ADMIN_PASSWORD`) |

## Reused functions / patterns

- `safeStorage` encrypt/decrypt helpers — `electron/config.cjs:144`.
- `SecretField` component inside the existing AI panel — reused on the
  Editor tab.
- `useCatalogHealth` hook (in `SettingsCatalogPanel.tsx`) — drives the
  Editor tab's friendly summary.
- `StorageOnboardingGate.tsx`'s RTL visual language — mirrored for
  `EditorLoginGate.tsx`.
- IPC handler shape from `electron/main.cjs:357` (`saveSettings`) —
  copied for the three new session-token channels.

## Non-Goals

- No user accounts, signup, password recovery, or password-strength UI —
  passwords are fixed per build by the maintainer.
- No remote auth provider (OAuth/SSO).
- No idle auto-lock of the Studio.
- No per-tab keyboard shortcut beyond the existing Escape close.
- No fine-grained permission system — single editor identity, single
  admin password.
- No audit log of admin unlocks.
- Not moving R2 onboarding (`StorageOnboardingGate`) into the new tabs —
  it stays as a first-run flow that runs after the editor login.
- No protection against an attacker with local code execution: a
  determined attacker can patch the bundle. This is UI gating, not crypto
  separation.
