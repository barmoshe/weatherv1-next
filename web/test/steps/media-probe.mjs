// Step: fetch the media routes the UI uses (poster, segment poster, narration,
// render) through the in-page API and report status, type and size.
import fs from "node:fs";
import path from "node:path";

export default async function mediaProbe({ page, log, library }) {
  const outputs = fs.readdirSync(path.join(library, "outputs")).filter((f) => f.endsWith(".mp4"));
  const jobs = JSON.parse(fs.readFileSync(path.join(library, ".weatherv1", "runtime", "jobs.json"), "utf8"));
  const list = Array.isArray(jobs) ? jobs : Object.values(jobs.jobs ?? jobs);
  const job = list.find((j) => j.audio_filename);
  const urls = [
    "/api/catalog/poster/W033",
    "/api/catalog/segment-poster/W033-s9",
    job ? `/api/voiceovers/${job.job_id}` : null,
    outputs[0] ? `/api/outputs/${outputs[0]}` : null,
  ].filter(Boolean);
  for (const u of urls) {
    const r = await page.evaluate(async (url) => {
      try {
        const res = await fetch(url);
        const blob = await res.blob();
        return `${res.status} ${res.headers.get("content-type")} ${blob.size}B ${res.ok ? "" : (await blob.text()).slice(0, 200)}`;
      } catch (e) {
        return `THREW ${e}`;
      }
    }, u);
    log(`${u} -> ${r}`);
  }
}
