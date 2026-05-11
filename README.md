# weatherV1-next

Next.js 16 / TypeScript port of the weather forecast video generator. Accepts an audio
recording of a weather narration, transcribes it via Whisper, plans a scene-aware clip
sequence from the local video catalog, and renders a 9:16 MP4 forecast video using ffmpeg.

## Docs

- [Production deploy on Oracle Cloud](docs/DEPLOY_ORACLE_CLOUD.md)
- [Architecture & deployment rationale](docs/DESIGN_DEPLOYMENT.md)

## Local dev

**Prerequisites:** Node 20+, ffmpeg on PATH, a `v1Drive/` media tree.

```bash
npm install
cp .env.example .env.local   # paste OPENAI_API_KEY (and GEMINI_API_KEY if available)
npm run dev                  # http://localhost:3000
```

The server reads `process.cwd()/../v1Drive/weather/` for the catalog and video files.
In dev that means `v1Drive/` must be a sibling directory next to this repo clone.

## Tests

```bash
npm test
```

## Docker

```bash
docker compose up -d --build
```
