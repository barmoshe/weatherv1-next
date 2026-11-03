// Step: prove the page reaches Claude through the real planning route. Saves an
// obviously fake key through the desktop bridge (Settings' save path), plans
// the last transcribed job, and expects Anthropic's "invalid key" answer
// mapped to the app's Hebrew error. A real key is only ever entered by the
// editor in Settings.
import fs from "node:fs";
import path from "node:path";

export default async function planProbe({ page, log, library }) {
  const raw = JSON.parse(fs.readFileSync(path.join(library, ".weatherv1", "runtime", "jobs.json"), "utf8"));
  const jobs = Array.isArray(raw) ? raw : Object.values(raw.jobs ?? raw);
  const job = jobs.find((j) => j.status === "draft") ?? jobs[0];
  const res = await page.evaluate(async (jobId) => {
    await window.desktop.saveSettings({ anthropicKey: "sk-ant-e2e-not-a-real-key" });
    const r = await fetch("/api/plan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        job_id: jobId,
        transcript: "היום מעונן חלקית ובהמשך גשם באזור הצפון.",
        duration: 10,
        transcript_segments: [{ idx: 0, start: 0, end: 10, text: "היום מעונן חלקית ובהמשך גשם באזור הצפון." }],
      }),
    });
    const body = await r.json();
    await window.desktop.saveSettings({ clearKeys: ["anthropic"] });
    return { status: r.status, body };
  }, job.job_id);
  log(`plan with a fake key -> ${res.status} ${JSON.stringify(res.body).slice(0, 300)}`);
  if (res.body.error_code !== "llm_invalid_key") throw new Error("expected Claude to reject the fake key (llm_invalid_key)");
}
