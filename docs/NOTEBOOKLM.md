# Using this repo with NotebookLM

NotebookLM grounds answers in **sources you add** (uploads, Google Drive files, Google Docs, pasted links, and similar). It does **not** clone Git or run your app. Treat this repo as **static text** you refresh when you want a new snapshot.

Official reference: [Add or discover new sources](https://support.google.com/notebooklm/answer/16215270).

## What NotebookLM accepts as an uploaded file

Uploads only accept specific extensions. **Markdown (`.md`) and plain text (`.txt`) are both supported**, along with PDF, Word (`.docx`), CSV, PowerPoint (`.pptx`), EPUB, common audio/video, and common images.

**Important:** Typical repo files such as **`.ts`, `.tsx`, `.js`, `.json`, `.xml`, or lockfiles are not** in that upload list. Do not point NotebookLM at raw source trees expecting every extension to import. Instead use the packs this repo generates (`.md` or `.txt`).

The chunk command writes **`notebooklm-dist/chunk-*.md`**, which are valid **`md`** sources. If your client ever rejects Markdown, run `npm run notebooklm:export:chunks:txt` to regenerate the same content as **`chunk-*.txt`** (`txt` is supported).

## Fast path (recommended): Markdown packs in-repo

1. From the repo root, generate packs:

   ```bash
   npm run notebooklm:export:chunks
   ```

   This writes four Markdown files under `notebooklm-dist/` (gitignored):

   | File | Contents |
   | --- | --- |
   | `chunk-01-docs.md` | README, `docs/*.md`, `AGENTS.md`, `CLAUDE.md`, WeatherV1 goal skill |
   | `chunk-02-src-server.md` | `src/server`, `src/shared` |
   | `chunk-03-src-app-client-tests.md` | `src/app`, `src/client`, `src/test`, `src/proxy.ts` |
   | `chunk-04-electron-scripts-infra.md` | `electron/`, `scripts/`, `infra/`, root configs |

   Plain-text copies (`chunk-*.txt`): `npm run notebooklm:export:chunks:txt` — same scope, for upload clients that prefer `txt`.

2. In NotebookLM, **Add source** → upload each chunk (or start with chunk 1 for narrative-only decks).

3. Use Studio / Audio / slides features as usual; cite sources so listeners can map claims back to paths in the pack.

**Single file (larger):** `npm run notebooklm:export` → `notebooklm-dist/weatherv1-full.md`. Prefer chunks if a source hits size limits.

**Security:** Repomix runs a secret scan when packing. Never commit `.env`; packs respect `.gitignore`. Do not paste live API keys into NotebookLM sources.

## Alternative: Google Drive

1. Run the export commands above, then sync only **supported** files (for example the generated `.md` or `.txt` chunks—not arbitrary `.ts` / `.json` from the repo).
2. Move or sync `notebooklm-dist/` into a Drive folder you control.
3. In NotebookLM, add sources from **Google Drive**. When you change the repo, regenerate the Markdown and replace or re-sync the Drive files, then refresh sources in NotebookLM if the product offers sync for that file type.

## Presentation tips

- **Start with chunk 1** so the model learns product goals and doc router (`DOCS_INDEX.md`).
- Ask for **outline → slide bullets → speaker notes** grounded in sources; name files (e.g. `scene-planner.ts`) when asking for technical depth.
- For **staff onboarding**, combine chunk 1 with `docs/PROJECT_GOAL.md` content (already inside chunk 1).

## Maintenance

Configs live at the repo root: `repomix.config.json`, `repomix.notebooklm-*.json`. Adjust `include` arrays if you add major top-level trees (e.g. new packages). See [Repomix configuration](https://repomix.com/guide/configuration).
