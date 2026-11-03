// Step: render a real, already-planned forecast through the in-page API, then
// check the MP4 the browser wrote into the library's outputs/ with ffprobe.
// Env: E2E_PLAN = a plan bundle JSON (timeline + audio_filename) from a past
//      job; E2E_AUDIO = its narration. Both are copied into the library.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export default async function render({ page, shot, log, library, outDir }) {
  const plan = JSON.parse(fs.readFileSync(process.env.E2E_PLAN, "utf8"));
  const jobId = `e2e${Date.now().toString(36)}`;
  const audioName = path.basename(plan.audio_filename);
  const uploads = path.join(library, ".weatherv1", "runtime", "uploads");
  fs.mkdirSync(uploads, { recursive: true });
  fs.copyFileSync(process.env.E2E_AUDIO, path.join(uploads, audioName));
  // The page loaded the library before the copy; tell its in-memory fs.
  await page.evaluate(
    ([vpath, size]) => window.__wv1Debug?.registerExternal(vpath, size),
    [`/ws/.weatherv1/runtime/uploads/${audioName}`, fs.statSync(path.join(uploads, audioName)).size],
  );

  const started = Date.now();
  const res = await page.evaluate(
    async ([job_id, audio_filename, timeline, scenes]) =>
      (await fetch("/api/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ job_id, audio_filename, timeline, scenes }),
      })).json(),
    [jobId, audioName, plan.timeline, plan.scenes ?? []],
  );
  if (!res.success) throw new Error(`render rejected: ${JSON.stringify(res)}`);
  log(`render queued (${plan.timeline.length} picks)`);

  let status;
  for (;;) {
    status = await page.evaluate(async (id) => (await fetch(`/api/status/${id}`)).json(), jobId);
    if (["completed", "failed"].includes(status.status)) break;
    if (Date.now() - started > 20 * 60_000) throw new Error("render timed out");
    await page.waitForTimeout(2000);
  }
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  if (status.status !== "completed") throw new Error(`render failed: ${JSON.stringify(status)}`);
  log(`rendered in ${secs}s`);

  const mp4 = path.join(library, "outputs", `forecast_${jobId}.mp4`);
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height:format=duration", "-of", "json", mp4]).toString();
  fs.writeFileSync(path.join(outDir, "render.json"), JSON.stringify({ seconds: Number(secs), mp4, probe: JSON.parse(probe) }, null, 2));
  fs.copyFileSync(mp4, path.join(outDir, "render.mp4"));
  log(`ffprobe: ${probe.replace(/\s+/g, " ")}`);

  await page.goto(page.url().replace(/([?&])job=[^&]*/, "$1") + `&job=${jobId}`);
  await page.waitForTimeout(5000);
  await shot("20-output");
}
