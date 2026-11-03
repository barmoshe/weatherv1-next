// Step: upload a narration through the studio's file input and wait for the
// local Hebrew transcript (first run downloads the model into the library).
// Env: E2E_AUDIO = narration file path.
import fs from "node:fs";
import path from "node:path";

export default async function transcribe({ page, shot, log, outDir }) {
  const audio = process.env.E2E_AUDIO;
  if (!audio) throw new Error("E2E_AUDIO is not set");
  const started = Date.now();
  await page.setInputFiles("#file-input", audio);
  log("narration uploaded, transcribing");
  await page.waitForSelector(".review-segment__text", { timeout: 30 * 60_000 });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const segments = await page.$$eval(".review-segment__text", (els) => els.map((e) => e.textContent?.trim() ?? ""));
  const times = await page.$$eval(".review-segment__time", (els) => els.map((e) => e.textContent?.trim() ?? ""));
  log(`transcribed in ${secs}s, ${segments.length} segments`);
  fs.writeFileSync(
    path.join(outDir, "transcript.json"),
    JSON.stringify({ seconds: Number(secs), segments: segments.map((text, i) => ({ time: times[i], text })) }, null, 2),
  );
  await shot("10-transcript");
}
