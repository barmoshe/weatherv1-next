// Step: the Claude key flow an editor sees, after `transcribe`, with an
// obviously fake key (a real key is only ever typed by the editor):
//   - a subscription token gets an instant "not an API key" warning,
//   - "save and check" stores the key, sends exactly it to Anthropic and shows
//     the rejection with the key's hint,
//   - planning then fails with a banner that offers Settings and "try again",
//     and "try again" really plans again (it used to hang on "processing"),
//   - a key typed and closed with × is saved, not dropped.
// Ends with the key cleared.

const FAKE = "sk-ant-api03-e2e-not-a-real-key-0000000000-AbCd";

export default async function keyUi({ page, shot, log }) {
  const sent = [];
  page.on("request", (r) => {
    if (r.url().startsWith("https://api.anthropic.com/")) sent.push(r.headers()["x-api-key"] ?? "");
  });
  const openSettings = async () => {
    await page.click('button[aria-label="הגדרות"]');
    await page.waitForSelector(".key-check-row", { timeout: 15_000 });
  };
  const keyInput = 'label.settings-field:has-text("מפתח Claude") input';

  await openSettings();
  await page.fill(keyInput, "sk-ant-oat01-e2e-subscription-token");
  await page.waitForSelector(".key-check--bad[role=alert]", { timeout: 5_000 });
  await shot("20-key-not-api");
  log("subscription token -> warned before saving");

  await page.fill(keyInput, ` ‏${FAKE}\n`);
  await page.click(".key-check-btn");
  await page.waitForSelector(".key-check-row .key-check--bad", { timeout: 30_000 });
  const line = await page.textContent(".key-check-row .key-check");
  await shot("21-key-rejected");
  if (!sent.includes(FAKE)) throw new Error(`the cleaned key was not what reached Anthropic: ${JSON.stringify(sent)}`);
  if (!/דחו/.test(line ?? "") || !/AbCd/.test(line ?? "")) throw new Error(`unexpected key line: ${line}`);
  log(`save and check -> Anthropic got the cleaned key, line: ${line?.trim()}`);
  await page.click(".modal-close");

  await page.click('[data-testid="review-continue"]');
  await page.waitForSelector('.error-banner[data-error-code="llm_invalid_key"]', { timeout: 60_000 });
  await shot("22-plan-banner");
  const before = sent.length;
  const retry = page.locator(".error-banner__action", { hasText: "נסה שוב" });
  if (!(await retry.count())) throw new Error("no 'try again' on the planning banner");
  if (!(await page.locator(".error-banner__action", { hasText: "פתיחת הגדרות" }).count())) {
    throw new Error("no 'open settings' on the key banner");
  }
  await retry.click();
  await page.waitForTimeout(3000);
  await page.waitForSelector('.error-banner[data-error-code="llm_invalid_key"]', { timeout: 60_000 });
  if (sent.length <= before) throw new Error("'try again' did not plan again");
  await shot("23-plan-retried");
  log(`try again -> planned again (${sent.length - before} new Claude call(s)), banner back`);

  await page.locator(".error-banner__action", { hasText: "פתיחת הגדרות" }).click();
  await page.waitForSelector(".key-check-row", { timeout: 15_000 });
  await page.waitForSelector(".key-check-row .key-check--bad", { timeout: 30_000 });
  await shot("24-settings-from-banner");
  await page.click("button.btn--ghost:has-text('נקה')");
  await page.waitForTimeout(800);
  await page.fill(keyInput, FAKE);
  await page.click(".modal-close");
  await page.waitForTimeout(800);
  await openSettings();
  const placeholder = await page.getAttribute(keyInput, "placeholder");
  await page.waitForSelector(".key-check-row .key-check--bad", { timeout: 30_000 });
  await shot("25-saved-on-close");
  if (!(await page.locator("button.btn--ghost:has-text('נקה')").count())) throw new Error("key typed then closed was not saved");
  log(`closed with a typed key -> saved (placeholder: ${placeholder})`);

  await page.click("button.btn--ghost:has-text('נקה')");
  await page.waitForTimeout(800);
  await page.click(".modal-close");
  log("key cleared");
}
