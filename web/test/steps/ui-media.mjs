// Step: open the newest completed job in the studio and check that its media
// actually shows: scene thumbnails decode, the finished video loads, the
// narration player isn't marked missing.
import fs from "node:fs";
import path from "node:path";

export default async function uiMedia({ page, shot, log, library }) {
  const raw = JSON.parse(fs.readFileSync(path.join(library, ".weatherv1", "runtime", "jobs.json"), "utf8"));
  const jobs = Array.isArray(raw) ? raw : Object.values(raw.jobs ?? raw);
  const job = jobs.filter((j) => j.status === "completed").sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  if (!job) throw new Error("no completed job in the library");
  const url = new URL(page.url());
  url.searchParams.set("job", job.job_id);
  await page.goto(url.href);
  await page.waitForTimeout(8000);
  const state = await page.evaluate(() => {
    const imgs = [...document.querySelectorAll("img.scene-pick-thumb")];
    const video = document.querySelector("video");
    return {
      thumbs: imgs.length,
      thumbsDecoded: imgs.filter((i) => i.complete && i.naturalWidth > 0).length,
      videoDuration: video ? video.duration : null,
      audioMissing: Boolean(document.querySelector("[data-testid=review-audio-missing]")),
    };
  });
  log(`job ${job.job_id}: ${JSON.stringify(state)}`);
  await shot("30-ui-media");
  if (state.thumbs && state.thumbsDecoded < state.thumbs) throw new Error("scene thumbnails did not load");
  if (!(state.videoDuration > 0)) throw new Error("finished video did not load");
  if (state.audioMissing) throw new Error("narration player marked missing");
}
