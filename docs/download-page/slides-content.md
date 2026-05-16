# WeatherV1 Pitch Deck - Editable Content (for ChatGPT)

## How to use this file (read this first)

This is the editable source for the **WeatherV1 pitch deck**: 5 slides, Hebrew (RTL), rendered as a scroll-driven single-page presentation.

Your job: edit only the **content fields** of each slide and return the **whole file** as markdown, structurally unchanged. Only the values inside the labeled fields should change.

### Editable fields per slide

- `kicker`: short label / chip above the title
- `title`: slide heading
- `lead`: opening paragraph
- `bullets`: desktop bullet list (may be empty for visual-only slides)
- `mobile_bullets`: shorter mobile bullets (may be empty)
- `mobile_summary`: single-paragraph mobile summary

### Do NOT edit these system fields

`id`, `visual`, `transition`, `panelLayout`, `theme`. They map to rendering logic; changing them breaks the deck. They are shown for context only.

### Language rules

- All copy stays in **Hebrew** (RTL).
- These names/terms stay in **English** as-is: `Weather V1`, `OpenAI`, `Claude`, `Whisper`, `Windows`, `Mac`, `API`, `API key`.
- The only HTML allowed inside copy is `<strong>...</strong>` (used for emphasis). No other tags, no `<br>`, no inline styles, no markdown bold (`**...**`) inside the copy: use the `<strong>` tag.
- **Do not use the em-dash character (U+2014) anywhere in the copy.** Use `:` (definitional pause), `,` (soft pause), `.` (strong pause), or `·` (middle dot) instead.
- **Direct voice.** Use `אצלכם`, `שלכם`, `מה נכון לכם`, `בסביבת העבודה שלכם`. Avoid `אצל V1`, `מה V1 צריכים`, `המערכת אצל V1`.
- **No price, no amount, no currency** anywhere in any slide.

### Length guides (soft)

- `kicker`: 1-3 words.
- `title`: up to 12 words, one line.
- `lead`: 1-3 sentences.
- `bullets`: up to 18 words each, 3-6 bullets.
- `mobile_bullets`: shorter than `bullets`, 3-5 items.
- `mobile_summary`: up to 2 sentences. A mobile reader will never see the visual: make sure this paragraph still conveys what the slide is about on its own.

### Responsive note

Desktop shows `bullets` + the visual mockup. Mobile (<860px) shows `mobile_summary` + `mobile_bullets` and **hides the visual**. Keep desktop and mobile variants consistent in meaning.

### Tone

Plain-language, transparent, no marketing fluff. The audience is the manager of V1, the person commissioning the work. Talk TO them, not ABOUT them.

### Output format

Return the **entire file** as markdown, structurally identical to what you received. Only the values of editable fields should differ. Do not add or remove slides. Do not rename labels. Do not translate.

---

## Deck context

- **Product:** WeatherV1, a desktop app that turns a forecast voice file into a vertical forecast video by transcribing the narration, breaking it into scenes, and matching footage from a managed catalog.
- **Audience:** the manager of V1, the person commissioning WeatherV1.
- **Goal of the deck:** explain what was built, what exists today, and how the work continues from here, in a simple, practical, non-technical way.
- **Slide order is intentional:** intro -> studio (the main work surface) -> catalog (the knowledge layer behind it) -> current state and options -> how we continue from here.

---

## Visual asset glossary

What's on-screen next to each slide's copy. Use this to keep copy consistent with what the viewer is also looking at.

- **`introPipeline`**: CSS/SVG curved-path flow diagram with 5 nodes (**Narration -> Transcription -> Scene Planning -> Video Match -> Render**) and a one-time `stroke-dashoffset` line draw on scroll-in. Symbolic glyphs (microphone, transcript lines, scene cards, film strip, vertical phone) at each node. No image files. No copy inside the diagram.
- **`studioDashboard`**: Interactive mockup of the Studio tab in the actual app:
  - Top tab strip: Studio / Active / History / Catalog / Analytics.
  - Audio drop zone with status indicators.
  - 4-cell bento grid: **Transcript / Render / Scene Planning / Output Preview**.
  - Clicking a bullet in the copy column highlights a different phase of the mockup. No autoplay.
  - Fixture: `PITCH_STUDIO_DEMO`, a sample weather forecast (center / north / coast), inline in the template.
  - Posters live under `docs/download-page/assets/posters/` (IB001-s0, IB002-s0, IB003-s0, ...).
  - Sample video: `docs/download-page/assets/mock-video-example.mp4` (used in the Output Preview cell).
- **`catalogScreenshot`**: Two real screenshots of the Catalog UI:
  - `docs/download-page/assets/segments-clips-catalog-screenshot.png`: grid of segments and clips with posters, search, filters, tags, sync status.
  - `docs/download-page/assets/catalog-segment-tag-modal.png`: modal for editing one segment's description and tags. Revealed by a button.
- **`localFirstPitch`**: 2x2 grid of 4 cards (קטלוג / תמלול / תכנון סצנות / רינדור). Each card has a symbolic header icon and two stacked blocks: `כיום` (now) and either `אפשרות להמשך` (option going forward) or `מה צריך` (what's needed) depending on the card. CSS only, no image files. Internal slide id stays `local-first` to preserve the URL hash and the scroll registry; the visible kicker is `מצב נוכחי`.
- **`closingRoadmap`**: Horizontal numbered roadmap with 5 nodes (1..5) connected by a thin accent line that draws right-to-left on scroll-in. Each node shows its `mobile_bullets` label below the number. No price, no chips, no fine print. CSS/SVG only.

---

## Slides

### Slide 1 - intro

- **id:** `intro`  *(do not edit)*
- **visual:** `introPipeline`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** *(default, none)*
- **theme:** paper `#ffffff`, accent `#f9543e`  *(do not edit)*

**kicker:** Weather V1

**title:** מקריינות תחזית לסרטון אנכי

**lead:**
> Weather V1 מקבלת קריינות תחזית, מתמללת אותה, מפרקת אותה לסצנות, מתאימה וידאו מהקטלוג, ומייצרת בסיס לסרטון תחזית.

**bullets:** *(none, visual-only slide)*

**mobile_bullets:** *(none, uses mobile_summary only)*

**mobile_summary:**
> קריינות תחזית, תמלול, פירוק לסצנות, רקע מהקטלוג, ובסיס לסרטון תחזית.

**graphics:** `introPipeline`, curved-path SVG diagram of five steps (Narration -> Transcription -> Scene Planning -> Video Match -> Render). Symbolic; no Hebrew text inside the diagram.

**notes:** Opening slide. One-line elevator pitch. Bullets intentionally empty: the visual carries the structure.

---

### Slide 2 - studio

- **id:** `studio`  *(do not edit)*
- **visual:** `studioDashboard`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-visual-heavy`  *(do not edit)*
- **theme:** paper `#f4f3ef`, accent `#c8202b`  *(do not edit)*

**kicker:** סטודיו

**title:** המקום שבו נבנה הסרטון בפועל

**lead:**
> הסטודיו הוא מסך העבודה המרכזי של האפליקציה: מעלים קריינות, המערכת מתמללת אותה באמצעות OpenAI, מודל ה־AI מחלק את הטקסט לסצנות ובוחר סגמנטים מהקטלוג, ואז מתבצע רינדור על המחשב והורדה של הסרטון.

**bullets:**
- העלאת קריינות: מתחילים מקובץ תחזית אחד.
- תמלול: המערכת הופכת את הקריינות לטקסט.
- תכנון AI: חלוקה לסצנות ובחירת סגמנטים מהקטלוג.
- רינדור והורדה: יצירת בסיס לסרטון תחזית והורדה שלו.

**mobile_bullets:**
- העלאת קריינות
- תמלול לטקסט
- תכנון סצנות
- רינדור והורדה

**mobile_summary:**
> הסטודיו הוא המקום שבו נבנה הסרטון בפועל: מקריינות לתמלול, מתכנון סצנות לבחירת סגמנטים, ואז רינדור והורדה.

**graphics:** `studioDashboard`, interactive mockup of the Studio tab. Tab strip on top, audio drop zone, 4-cell bento (Transcript / Render / Scene Planning / Output Preview). Each bullet is clickable and highlights its matching phase in the mockup; phase 4 shows an iPhone-frame preview on the left with transcript + scene plan on the right.

**notes:** Bullets here are an **interactive index** to the mockup, not just decoration. Bullet #1 maps to phase 1 (upload), #2 to phase 2 (transcription), #3 to planning, #4 to render. Keep order and meaning aligned with the phases. If you change the bullet count or reorder, the mapping breaks.

---

### Slide 3 - catalog

- **id:** `catalog`  *(do not edit)*
- **visual:** `catalogScreenshot`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-visual-heavy`  *(do not edit)*
- **theme:** paper `#f4f6fb`, accent `#3d55b8`  *(do not edit)*

**kicker:** קטלוג

**title:** הקטלוג: המקום שבו מסדרים את חומרי הווידאו

**lead:**
> הקטלוג מרכז את חומרי הווידאו בצורה מסודרת. כיום יש בו כ־200 סרטונים, שלאחר חלוקה לסגמנטים הופכים לכ־400 קטעים קצרים שהמערכת יכולה לבחור מהם בזמן יצירת הסרטון.

**bullets:**
- כל סרטון בקטלוג מחולק לסגמנטים קצרים.
- לכל סרטון יש תיאור כללי ותגיות שמסבירות מה הוא מכיל.
- לכל סגמנט יש תיאור ותגיות משלו: מה רואים בו, איזו אווירה יש בו, ולאיזו סצנה הוא יכול להתאים.
- התיאורים והתגיות עוזרים למודל ה־AI להבין את חומרי הווידאו ולבחור קטע מתאים לכל סצנה.
- הבחירה נעשית לפי משמעות הסצנה, לא לפי שם קובץ אקראי.

**mobile_bullets:**
- כ־200 סרטונים בקטלוג
- כ־400 סגמנטים אחרי חלוקה
- תיאור ותגיות לכל סרטון
- תיאור ותגיות לכל סגמנט

**mobile_summary:**
> הקטלוג מסדר את חומרי הווידאו: כ־200 סרטונים שמחולקים לכ־400 סגמנטים. לכל סרטון ולכל סגמנט יש תיאור ותגיות, כדי שהמערכת תוכל לבחור קטעים לפי מה שרואים בהם ולפי ההקשר של התחזית.

**graphics:** `catalogScreenshot`, two screenshots of the real Catalog UI: (1) grid of segments and clips with posters / search / filters / tags / sync status; (2) modal for editing a single segment's description and tags, shown on click.

**notes:** The lead deliberately leads with concrete numbers (~200 videos / ~400 segments) since they make the catalog tangible. No `<strong>` tags in the current copy.

---

### Slide 4 - current state / options

- **id:** `local-first`  *(do not edit, internal id kept to preserve URL hash and scroll registry)*
- **visual:** `localFirstPitch`  *(do not edit, the renderer key is reused for the 4-card grid)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-visual-heavy`  *(do not edit)*
- **theme:** paper `#f4f6fa`, accent `#475569`  *(do not edit)*

**kicker:** מצב נוכחי

**title:** מה קיים היום ומה אפשר לשנות בהמשך

**lead:**
> כיום Weather V1 עובדת בצורה מקומית לשלב העבודה הנוכחי: הרינדור קורה על המחשב, הקטלוג נשמר בענן פרטי לצורכי פיתוח, והתמלול ותכנון הסצנות משתמשים ב־API keys של OpenAI / Claude. בהמשך אפשר להעביר חלקים מהמערכת לתשתיות שלכם, לפי מה שנכון לכם.

**bullets:** *(none, the 4-card visual carries the desktop content)*

**mobile_bullets:**
- רינדור מקומי על המחשב
- קטלוג בענן פרטי לצורכי פיתוח
- OpenAI לתמלול
- Claude / OpenAI לתכנון סצנות
- אפשרות להעביר חלקים לתשתיות שלכם

**mobile_summary:**
> כיום Weather V1 עובדת בצורה מקומית לשלב העבודה הנוכחי: הרינדור קורה על המחשב, הקטלוג נמצא בענן פרטי לצורכי פיתוח, והתמלול ותכנון הסצנות משתמשים ב־API keys. בהמשך אפשר להעביר חלקים מהמערכת לתשתיות שלכם לפי הצורך.

**graphics:** `localFirstPitch`, 2x2 grid of 4 cards. Card content (rendered inside `localFirstPitchHtml()` in the template; not editable from this file):

- **Card 1 - קטלוג**: כיום: `הקטלוג שמור בענן פרטי שלי לצורכי פיתוח ובדיקות.` / אפשרות להמשך: `להעביר את הקטלוג למחשב, שרת או ענן שלכם, כדי שהחומרים יהיו אצלכם.`
- **Card 2 - תמלול**: כיום: `התמלול מתבצע באמצעות OpenAI.` / מה צריך: `OpenAI API key לצורך תמלול הקריינות.`
- **Card 3 - תכנון סצנות**: כיום: `קבלת ההחלטות ותכנון הסצנות מתבצעים בעזרת Claude או OpenAI.` / מה צריך: `API key מתאים לפי המודל שבו בוחרים להשתמש.`
- **Card 4 - רינדור**: כיום: `הרינדור מתבצע מקומית על המחשב שבו האפליקציה מותקנת.` / אפשרות להמשך: `אם רוצים עבודה מרחוק, מכמה מחשבים או מטלפון, צריך פתרון ענן מתקדם יותר.`

**notes:** This slide replaced an older "local-first" comparison-table framing. The visible kicker is now `מצב נוכחי`, not `מקומית`. The internal slide id stays `local-first` so the `#local-first` URL hash and CSS selectors continue to work.

---

### Slide 5 - how we continue

- **id:** `next-steps`  *(do not edit)*
- **visual:** `closingRoadmap`  *(do not edit)*
- **transition:** `ttb`  *(do not edit)*
- **panelLayout:** `split-copy-heavy`  *(do not edit)*
- **theme:** paper `#f4fcf8`, accent `#0d9488`  *(do not edit)*

**kicker:** המשך

**title:** איך ממשיכים מכאן

**lead:**
> אחרי שראינו מה קיים היום, השלב הבא הוא לסגור יחד כמה דברים קטנים כדי להביא את Weather V1 למצב שעובד אצלכם בפועל.

**bullets:**
- להבין מה חשוב לדייק לפני שימוש אמיתי.
- להחליט איפה נכון לשמור את הקטלוג בהמשך.
- לחבר את ה־API keys הרלוונטיים.
- לבדוק את המערכת בסביבת העבודה שלכם.
- לסגור יחד את היקף ההמשך בצורה פשוטה וברורה.

**mobile_bullets:**
- מה צריך לדייק
- איפה יישב הקטלוג
- חיבור API keys
- בדיקה אצלכם
- סגירת היקף ההמשך

**mobile_summary:**
> מכאן ממשיכים יחד: מה צריך לסגור, מה צריך לחבר, ואיך מביאים את Weather V1 למצב שעובד אצלכם בפועל.

**graphics:** `closingRoadmap`, horizontal numbered roadmap of 5 nodes connected by a thin accent line. Each node shows the corresponding `mobile_bullets` label below the number. No price, no chips, no fine print.

**closing_options:** *(rendered inline by the template, not editable from this file)*

Below the bullets on desktop, a small dashed-border card titled `אופציות להמשך, אם נרצה` lists two parallel "integrations" we could do later:

1. **שילוב עם Adobe Premiere.** אפשר לחבר את Weather V1 לתהליך עבודה ב־Adobe Premiere, כך שהמשך העבודה יקרה ישירות מתוך תוכנת העריכה.
2. **שילוב שכבות הגרפיקה שלכם.** אפשר לחבר את שכבות הגרפיקה הקיימות שלכם (לוגואים, כותרות ומיתוג) לתוך Weather V1, כך שהאפליקציה תייצר את הסרטון המוגמר ולא רק את הבסיס.

Both are phrased as open possibilities (`אם נרצה`, `אפשר`), not commitments, and both follow the same "שילוב" framing: one integrates Weather V1 with an external editor, the other integrates V1's existing graphics package into the app. The mobile single-page overview surfaces the same two directions as a short paragraph between the topics list and the desktop CTA card. To change the wording, edit the `closingOptionsBlock` template literal inside `singlePanelSectionHtml()` and the `.pitch-mobile-page__horizon` paragraph inside the `<main class="pitch-mobile-page">` markup; both live in `docs/download-page/index.html.template`.

**notes:** This slide merges what used to be two separate slides (a pricing slide and a final next-steps slide). It deliberately does NOT show a price; pricing lives in the verbal conversation. Do not add an amount, do not write `המחיר יוצג בשיחה`, do not use `התקנה ראשונית`. The `closing_options` block above is a separate, optional layer that names future-direction possibilities; it is not part of the committed scope.

---

## Paste-back map (for the human syncing edits)

When the edited markdown comes back from ChatGPT, copy each field into the corresponding key in the `storySections` array inside `docs/download-page/index.html.template`.

| Markdown label   | JS key in `storySections`          | Type                        |
|------------------|------------------------------------|-----------------------------|
| `kicker`         | `kicker`                           | string                      |
| `title`          | `title`                            | string                      |
| `lead`           | `lead`                             | string (may contain `<strong>`) |
| `bullets`        | `bullets`                          | string[] (preserve order)   |
| `mobile_bullets` | `mobileBullets`                    | string[] (preserve order)   |
| `mobile_summary` | `mobileSummary`                    | string                      |

System fields (`id`, `visual`, `transition`, `panelLayout`, `theme`) should already match: only the six content fields above are editable from this file. After sync, rebuild / refresh the page and visually confirm:

1. All 5 slides render in order: intro -> studio -> catalog -> current state -> closing (next-steps).
2. Desktop view shows new `bullets` next to each visual (slide 4 has no desktop bullets; the 4-card grid carries the content).
3. Mobile view (resize browser <860px) shows new `mobile_summary` + `mobile_bullets` and hides visuals.
4. No em-dash (U+2014) anywhere in visible copy. No price, no `₪`, no `מע״מ`, no `התקנה ראשונית`, no `המחיר יוצג בשיחה`, no `אצל V1`.
