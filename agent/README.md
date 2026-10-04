# agent/ — the forecast made locally by a Claude agent (POC)

A second way to make the V1 forecast, next to the app: a Claude Code session on the machine that
holds the catalog runs fixed CLI tools and makes only the judgement calls (transcript corrections,
scene plan, clip picks, frame review). The workflow and rules live in the skill:
[`.claude/skills/v1-forecast/SKILL.md`](../.claude/skills/v1-forecast/SKILL.md).

```bash
npx tsx agent/cli.ts doctor
npx tsx agent/cli.ts <command> <job-dir> [args]
```

| Command | Does | Reuses from the app |
|---|---|---|
| `doctor` | ffmpeg, Chrome for Playwright, Whisper + model, catalog parse | `parseCatalog` |
| `transcribe` | local Whisper, word timestamps → `transcript.json` | `WHISPER_HE_PROMPT` |
| `align` | forced alignment (Hebrew wav2vec2): every plan time moved onto the real voice | |
| `plan-validate` | schema, scenes tile the timeline, every cue on a word start, captions | zod |
| `search <scene>` | ranked shortlist + numbered contact sheet | `retrieveCandidates`, `VERTICAL_SCALE_CROP_FILTER` |
| `picks-validate` | in catalog, local file, no reuse, long enough, clothing/climate | `clothingClimateMismatch` |
| `render-bg` | cut, crop 9:16 with drift, grade, concat → `bg.mp4` | vertical frame contract |
| `render-gfx` | `gfx/template.html` driven by `plan.json` → transparent frames (`--at` previews) | |
| `compose` | voice untouched + catalog music bed, -14 LUFS / limiter → `mix.wav`; then footage + graphics → `final.mp4` + `final-share.mp4` (< 30 MB) | |
| `qc` | frames at every cut and mid-scene, loudness, black frames → `qc/qc.jpg`, `qc.json` | |

**Nothing from the catalog is ever committed here.** Job folders live outside the repo
(`~/v1-agent-jobs/…`); the catalog stays at `~/v1Drive/weather` (`WEATHER_WORKSPACE_DIR`).
`gfx/fonts/` is Heebo (OFL) and `gfx/map.js` is a Natural Earth outline (public domain).

Environment: `WEATHER_AGENT_PYTHON` (a Python with `openai-whisper`, `torchaudio`, `transformers` and NumPy < 2),
`WEATHER_AGENT_WHISPER` (model, default `medium`), `WEATHER_AGENT_WORKERS` (frame workers, default 6),
`WEATHER_AGENT_MUSIC` (music bed; default the catalog's `music/מוזיקת אנדר לתחזית.mp3`).
