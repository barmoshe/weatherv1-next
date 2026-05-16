# WeatherV1 Pitch Deck — Editable Content (for ChatGPT)

## How to use this file (read this first)

This is the editable source for the **WeatherV1 pitch deck** — 6 slides, Hebrew (RTL), rendered as a scroll-driven single-page presentation.

Your job: edit only the **content fields** of each slide and return the **whole file** as markdown, structurally unchanged. Only the values inside the labeled fields should change.

### Editable fields per slide

- `kicker` — short label / chip above the title
- `title` — slide heading
- `lead` — opening paragraph
- `bullets` — desktop bullet list (may be empty for visual-only slides)
- `mobile_bullets` — shorter mobile bullets (may be empty)
- `mobile_summary` — single-paragraph mobile summary

### Do NOT edit these system fields

`id`, `visual`, `transition`, `panelLayout`, `theme`. They map to rendering logic; changing them breaks the deck. They are shown for context only.

### Language rules

- All copy stays in **Hebrew** (RTL).
- These names/terms stay in **English** as-is: `Weather V1`, `OpenAI`, `Claude`, `Whisper`, `Windows`, `Mac`, `API`, `API key`.
- The only HTML allowed inside copy is `<strong>...</strong>` (used for emphasis inside `lead`). No other tags, no `<br>`, no inline styles, no markdown bold (`**...**`) inside the copy — use the `<strong>` tag.
- Hebrew abbreviation punctuation uses `״` (gershayim), e.g. `מע״מ`, `רו״ח`. The current source mixes `מע״מ` and `מע״ם` (a typo) — standardize to `מע״מ` and mention the fix at the top of your reply.

### Length guides (soft)

- `kicker`: 1–3 words.
- `title`: ≤ 12 words, one line.
- `lead`: 1–3 sentences.
- `bullets`: ≤ 18 words each, 3–6 bullets.
- `mobile_bullets`: shorter than `bullets`, 3–4 items.
- `mobile_summary`: ≤ 2 sentences. A mobile reader will never see the visual — make sure this paragraph still conveys what the slide is about on its own.

### Responsive note

Desktop shows `bullets` + the visual mockup. Mobile (<860px) shows `mobile_summary` + `mobile_bullets` and **hides the visual**. Keep desktop and mobile variants consistent in meaning.

### Tone

Plain-language, transparent, no marketing fluff. The audience is the client commissioning WeatherV1 (familiar with weather broadcasting workflows), not the general public.

### Output format

Return the **entire file** as markdown, structurally identical to what you received. Only the values of editable fields should differ. Do not add or remove slides. Do not rename labels. Do not translate.

---

## Deck context

- **Product:** WeatherV1 — a desktop app that turns a forecast voice file into a vertical forecast video by transcribing the narration, breaking it into scenes, and matching footage from a managed catalog.
- **Audience:** the client commissioning WeatherV1.
- **Goal of the deck:** explain what was built, why the app is local-first today, the price proposal, and the next steps to first install.
- **Slide order is intentional:** intro → studio (what they use day-to-day) → catalog (the knowledge layer behind it) → why local-first → pricing → next steps.

---

## Visual asset glossary

What's on-screen next to each slide's copy. Use this to keep copy consistent with what the viewer is also looking at.

- **`introPipeline`** — CSS/SVG horizontal flow diagram: **Narration → Transcription → Scene Planning → Video Match → Render**. No image files. No copy inside the diagram.
- **`studioDashboard`** — Interactive mockup of the Studio tab in the actual app:
  - Top tab strip: Studio / Active / History / Catalog / Analytics.
  - Audio drop zone with status indicators.
  - 4-cell bento grid: **Transcript / Render / Scene Planning / Output Preview**.
  - Clicking a bullet in the copy column highlights a different phase of the mockup. No autoplay.
  - Fixture: `PITCH_STUDIO_DEMO` — a sample weather forecast (center / north / coast), inline in the template.
  - Posters live under `docs/download-page/assets/posters/` (IB001-s0, IB002-s0, IB003-s0, ...).
  - Sample video: `docs/download-page/assets/mock-video-example.mp4` (used in the Output Preview cell).
- **`catalogScreenshot`** — Two real screenshots of the Catalog UI:
  - `docs/download-page/assets/segments-clips-catalog-screenshot.png` — grid of segments and clips with posters, search, filters, tags, sync status.
  - `docs/download-page/assets/catalog-segment-tag-modal.png` — modal for editing one segment's description and tags. Revealed by a button.
- **`localFirstPitch`** — Two-column comparison table. Columns: **נושא / כיום / אופציה להמשך** (Subject / Now / Option going forward). Two rows: rendering, catalog storage. No image files.
- **`pricingHero`** — Styled pricing card:
  - Eyebrow: `הצעה ראשונית · להמחשה במצגת`
  - Big amount: **4,000 ₪**
  - Fine print: `דמו מצגת — לא חוזה`
  - Two chips: `עד התקנה ראשונה אצלכם`, `כולל AI וטוקנים בפיתוח`
- **`none`** — Text-only slide, no visual mockup.

---

## Slides

### Slide 1 — intro

- **id:** `intro`  *(do not edit)*
- **visual:** `introPipeline`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** *(default — none)*
- **theme:** paper `#ffffff`, accent `#f9543e`  *(do not edit)*

**kicker:** Weather V1

**title:** מקריינות תחזית לסרטון אנכי

**lead:**
> Weather V1 מקבלת קריינות תחזית, מתמללת אותה, מפרקת אותה לסצנות, מתאימה וידאו מהקטלוג, ומייצרת בסיס לסרטון תחזית.

**bullets:** *(none — visual-only slide)*

**mobile_bullets:** *(none — uses mobile_summary only)*

**mobile_summary:**
> קריינות תחזית, תמלול, פירוק לסצנות, רקע מהקטלוג, ובסיס לסרטון תחזית.

**graphics:** `introPipeline` — horizontal flow diagram of five steps (Narration → Transcription → Scene Planning → Video Match → Render). Symbolic; no Hebrew text inside the diagram.

**notes:** Opening slide. One-line elevator pitch. Bullets intentionally empty — the visual carries the structure.

---

### Slide 2 — studio

- **id:** `studio`  *(do not edit)*
- **visual:** `studioDashboard`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-visual-heavy`  *(do not edit)*
- **theme:** paper `#f4f3ef`, accent `#c8202b`  *(do not edit)*

**kicker:** סטודיו

**title:** טאב הסטודיו — איפה נבנית התחזית

**lead:**
> בסטודיו מתקדמים שלב־אחר־שלב: העלאת קריינות, תמלול לטקסט, תכנון סצנות והחלטות על קטעים מהקטלוג, ואז רינדור לקובץ וידאו בסיס אנכי. בחרו בשורת השלבים במוקאפ כדי לראות איך המסך מתמלא — בלי הפעלה אוטומטית.

**bullets:**
- העלאה — מתחילים מקובץ קריינות אחד.
- תמלול — הקריינות הופכת לטקסט שאפשר לעבוד איתו.
- תכנון והחלטות — המערכת מחלקת לסצנות ומתאימה קטעים מהקטלוג לפי ההקשר.
- רינדור והורדה — מתקבל בסיס לסרטון תחזית אנכי (קריינות, רקע ערוך, מוזיקה), לפני מיתוג גרפי מלא.

**mobile_bullets:**
- העלאת קריינות.
- תמלול לטקסט.
- תכנון סצנות והתאמות מהקטלוג.
- רינדור והורדת בסיס אנכי.

**mobile_summary:**
> מסלול אחד: קריינות, תמלול, סצנות והתאמות מהקטלוג, ורינדור. גללו למוקאפ ובחרו שלב מהרשימה.

**graphics:** `studioDashboard` — interactive mockup of the Studio tab. Tab strip on top, audio drop zone, 4-cell bento (Transcript / Render / Scene Planning / Output Preview). Each bullet is clickable and highlights its matching phase in the mockup; phase 4 shows an iPhone-frame preview on the left with transcript + scene plan on the right.

**notes:** Bullets here are an **interactive index** to the mockup, not just decoration — bullet #1 maps to phase 1 (upload), #2 to phase 2 (transcription), #3 to planning, #4 to render. Keep order and meaning aligned with the phases. If you change the bullet count or reorder, the mapping breaks.

---

### Slide 3 — catalog

- **id:** `catalog`  *(do not edit)*
- **visual:** `catalogScreenshot`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-visual-heavy`  *(do not edit)*
- **theme:** paper `#f4f6fb`, accent `#3d55b8`  *(do not edit)*

**kicker:** קטלוג

**title:** הקטלוג — מחסן חכם לחומרי הווידאו של V1

**lead:**
> הקטלוג הוא לא רק תיקייה של קבצים, אלא <strong>מאגר מסודר וחכם</strong> של סרטונים וסגמנטים קצרים. לכל קטע אפשר להוסיף תיאור ותגיות — ידנית או בעזרת AI — כדי להסביר מה רואים בו, איזו אווירה יש לו, ולאיזה סוג סצנה בתחזית הוא יכול להתאים. כשמגיעה סצנה מהתמלול, המערכת יכולה לבחור רקעים לפי המשמעות של הקריינות והסגמנט, ולא לפי שם קובץ אקראי. ככל שהתיוג והתיאור טובים יותר, כך הבחירה האוטומטית יכולה להיות מדויקת יותר.

**bullets:**
- רשת קליפים וסגמנטים — חיפוש, סינון, פוסטרים וסטטוס במבט אחד.
- תיאור ותגיות לכל קטע — מה רואים, איזו אווירה, ולאיזו סצנה בתחזית הוא מתאים.
- תיוג ידני או בעזרת AI — כדי להפוך חומרי וידאו לשכבת ידע שימושית.
- מהקטלוג נבחרים רקעים לסצנות לפי משמעות הקריינות, לא לפי שם קובץ אקראי.

**mobile_bullets:**
- סגמנטים קצרים עם פוסטר, תיאור ותגיות.
- חיפוש וסינון של חומרי V1 במקום אחד.
- תיוג ידני או בעזרת AI.
- בחירת רקעים לפי משמעות הקריינות.

**mobile_summary:**
> מחסן חכם לסגמנטים עם תיאור ותגיות — בחירת רקעים לפי משמעות הסצנה, לא לפי שם קובץ.

**graphics:** `catalogScreenshot` — two screenshots of the real Catalog UI: (1) grid of segments and clips with posters / search / filters / tags / sync status; (2) modal for editing a single segment's description and tags, shown on click.

**notes:** The `<strong>...</strong>` inside `lead` is intentional — it emphasizes the "smart repository" framing. Keep it (or move it to a different phrase if you re-write that sentence), but no other HTML.

---

### Slide 4 — local-first

- **id:** `local-first`  *(do not edit)*
- **visual:** `localFirstPitch`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-visual-heavy`  *(do not edit)*
- **theme:** paper `#f4f6fa`, accent `#475569`  *(do not edit)*

**kicker:** מקומית

**title:** למה האפליקציה מקומית כרגע

**lead:**
> כרגע Weather V1 היא אפליקציה שמתקינים על מחשב. הסיבה היא שהעבודה עם קבצי המדיה והרינדור מתבצעים לוקלית, והקטלוג צריך להיות זמין לאפליקציה בצורה יציבה ומהירה. בשלב הנוכחי זה הפתרון הכי פשוט להתחיל לעבוד: האפליקציה מותקנת על מחשב, הרינדור קורה על אותו מחשב, והקטלוג יכול להישמר מקומית או לעבור בהמשך לאחסון שלכם.

**bullets:** *(none — the visual is a comparison table that carries the content)*

**mobile_bullets:** *(none — uses mobile_summary only)*

**mobile_summary:**
> מקומית כי רינדור ומדיה על המחשב שלכם והקטלוג צריך להיות זמין בצורה יציבה. מרחוק בעתיד — ענן שמרנדר ומאחסן מרחוק. בטבלה: רינדור מול אחסון קטלוג.

**graphics:** `localFirstPitch` — comparison table with columns **נושא / כיום / אופציה להמשך**. Rows: rendering (now: runs on the install machine; option: cloud rendering if you want to work from phone / remote) and catalog storage (now: private cloud for dev & testing; option: local with you, or your own cloud).

**notes:** The mobile_summary explicitly references the table because mobile readers won't see it. Keep that reference (or replace it with the same information in prose) so mobile readers still get the comparison.

---

### Slide 5 — pricing

- **id:** `pricing`  *(do not edit)*
- **visual:** `pricingHero`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-copy-heavy`  *(do not edit)*
- **theme:** paper `#f4fcf8`, accent `#0d9488`  *(do not edit)*

**kicker:** הצעת מחיר

**title:** עלות והמשך עבודה

**lead:**
> מחיר ראשוני ושקוף, עם מקום לעדכון אם ההיקף משתנה.

**bullets:**
- הצעת מחיר ראשונית: 4,000 ₪ לפני מע״מ / אם צריך — ניסוח סופי מול רואה חשבון כשנדרש
- המחיר כולל את מה שכבר נעשה ואת המשך העבודה עד להתקנה ראשונית אצלכם במחשבי העבודה הרלוונטיים
- לא רק שעות פיתוח — גם שימוש בכלי AI ובטוקנים תוך כדי העבודה
- אם בהמשך העבודה תצמח מעבר למוסכמות — נדבר ונעדכן מחיר בהתאם
- מה נבנה בפועל (לפי הריפו והקומיטים האחרונים): אפליקציית דסקטופ עם סטודיו, קטלוג, תכנון סצנות ותמלול מקריינות, רינדור בסיסי לאנכי, הגדרות וסנכרון לענן — ודף ההורדות הזה במצגת.

**mobile_bullets:**
- 4,000 ₪ לפני מע״ם (ניסוח סופי מול רו״ח כשנדרש).
- כולל המשך עבודה עד להתקנה אצלכם + שימוש ב־AI וטוקנים בפיתוח.
- היקף שגדל מעבר למוסכמות — עדכון מחיר בהסכמה.

**mobile_summary:**
> הצעה ראשונית שקופה: 4,000 ₪ לפני מע״ם לפי הצורך — עד להתקנה ראשונית אצלכם.

**graphics:** `pricingHero` — styled card next to the copy: eyebrow `הצעה ראשונית · להמחשה במצגת`, big amount **4,000 ₪**, fine print `דמו מצגת — לא חוזה`, two chips (`עד התקנה ראשונה אצלכם`, `כולל AI וטוקנים בפיתוח`).

**notes:** The source has `מע״ם` (with final mem) in `mobile_bullets` and `mobile_summary` here — that's a typo, the desktop `bullets` correctly use `מע״מ`. Per the language rule at the top of this file, please standardize to `מע״מ` in your edit. The price number `4,000` is also rendered visually in the card art; if you change the number in copy, the card itself needs the same change separately (not editable from this file).

---

### Slide 6 — v1-next

- **id:** `v1-next`  *(do not edit)*
- **visual:** `none`  *(do not edit — text-only slide)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** *(default — none)*
- **theme:** paper `#faf8f5`, accent `#78716c`  *(do not edit)*

**kicker:** סיכום והמשך

**title:** מה צריך כדי להתקדם להתקנה ראשונית

**lead:**
> כמה החלטות פשוטות וחיבורים בסיסיים — ואפשר להתחיל לעבוד באמת על תחזיות.

**bullets:**
- אישור כיוון העבודה
- החלטה לגבי אחסון הקטלוג — מקומי או בענן שלכם
- התקנה ראשונית במחשבי העבודה הרלוונטיים
- חיבור OpenAI API key לתמלול ולפי הצורך גם לתכנון
- חיבור Claude API key רק אם בוחרים להשתמש ב־Claude לתכנון הסצנות
- סבב התאמות לפי פידבק אחרי שימוש אמיתי

**mobile_bullets:**
- אישור כיוון והתקנה ראשונית במחשבי העבודה.
- אחסון קטלוג — מקומי או בענן שלכם.
- חיבור מפתחות API (OpenAI לתמלול/תכנון; Claude רק אם בוחרים).
- סבב התאמות אחרי שימוש אמיתי.

**mobile_summary:**
> החלטות קצרות וחיבורים בסיסיים — ומתחילים להריץ תחזיות באופן מעשי.

**graphics:** none — text-only slide, by design.

**notes:** Closing call-to-action. Keep the bullets concrete and action-oriented (each one is something the client decides or does). Do not collapse the OpenAI and Claude bullets into one — they're listed separately because Claude is **opt-in** and OpenAI is required.

---

## Paste-back map (for the human syncing edits)

When the edited markdown comes back from ChatGPT, copy each field into the corresponding key in the `storySections` array inside `docs/download-page/index.html.template` (lines ~4099–4226).

| Markdown label   | JS key in `storySections`          | Type                        |
|------------------|------------------------------------|-----------------------------|
| `kicker`         | `kicker`                           | string                      |
| `title`          | `title`                            | string                      |
| `lead`           | `lead`                             | string (may contain `<strong>`) |
| `bullets`        | `bullets`                          | string[] (preserve order)   |
| `mobile_bullets` | `mobileBullets`                    | string[] (preserve order)   |
| `mobile_summary` | `mobileSummary`                    | string                      |

System fields (`id`, `visual`, `transition`, `panelLayout`, `theme`) should already match — only the six content fields above are editable from this file. After sync, rebuild / refresh the page and visually confirm:

1. All 6 slides render in order: intro → studio → catalog → local-first → pricing → v1-next.
2. Desktop view shows new `bullets` next to each visual.
3. Mobile view (resize browser < 860px) shows new `mobile_summary` + `mobile_bullets` and hides visuals.
4. Slide 3 (catalog) still renders bold text where the `<strong>` tag is.
