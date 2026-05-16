# Weather V1 Pitch Deck Redesign - Handoff Report

> **Status:** design + copy spec, ready to implement.
> **Scope:** redesign the existing 6-slide pitch deck at `docs/download-page/index.html.template` into a polished 5-slide deck. No code has been changed by this report; it is a single self-contained handoff that the next implementer (human or agent) can ship in one pass.
> **Audience for the deck:** the manager of V1. The deck talks TO them, not ABOUT them.

---

## TL;DR

1. Drop from **6 slides to 5**: `intro -> studio -> catalog -> current state -> how we continue`.
2. **Merge** the old pricing slide and the old final next-steps slide into one polished closing slide. No price, no amount, no contract feel.
3. **Reframe slide 4** as a 4-card layout (`קטלוג`, `תמלול`, `תכנון סצנות`, `רינדור`) instead of a 2-row comparison table. The kicker becomes `מצב נוכחי`, not `מקומית`.
4. **Warm up slide 1**: keep the 5-step pipeline idea, but draw it as a staggered SVG path with small symbolic glyphs and a one-time scroll-in line draw, instead of a flat row of labels and arrows.
5. **Keep the Studio mockup as-is** (light copy edits only). Keep the catalog screenshots + modal interaction (light framing edits only).
6. **Audience voice shift**: use `אצלכם`, `שלכם`, `מה נכון לכם`, `בסביבת העבודה שלכם`. Stop using `אצל V1`, `מה V1 צריכים`, `המערכת אצל V1`.
7. **Em-dash (U+2014) is banned** everywhere in the deck copy (and in this report). Use `:`, `,`, `.`, `·`, or a plain hyphen ` - ` instead.
8. **Keep the internal id `local-first`** for slide 4 to avoid breaking the URL hash, the scroll registry, the per-slide GSAP config, and any external links. Only the visible kicker, title, lead, and visual change.

---

## Audience + tone shift

The current deck treats V1 as a third party the speaker is describing. The new deck treats V1's manager as the person sitting across the table.

| Before (talking ABOUT V1) | After (talking TO V1's manager) |
|---|---|
| `הקטלוג, מחסן חכם לחומרי הווידאו של V1` | `הקטלוג, המקום שבו מסדרים את חומרי הווידאו` |
| `התקנה ראשונית במחשבי העבודה הרלוונטיים` | `לבדוק את המערכת בסביבת העבודה שלכם` |
| `בענן פרטי לצורכי פיתוח ובדיקות` (neutral) | `הקטלוג שמור בענן פרטי שלי לצורכי פיתוח` (owns the current state) |
| `אם בהמשך העבודה תצמח מעבר למוסכמות, נדבר ונעדכן מחיר בהתאם` (contractual) | `לסגור יחד את היקף ההמשך בצורה פשוטה וברורה` (collaborative) |
| Hard amount on the slide (`4,000 ₪`) | No amount on any slide; pricing lives in the spoken conversation |

Tone rules to apply consistently:

- Plain language, transparent, human, not formal.
- No marketing fluff. No invented features.
- No architecture jargon (no "buckets", "infrastructure", "cloud rendering architecture", etc.).
- Don't dramatize what the system does; describe it as it is.
- Keep `Weather V1`, `OpenAI`, `Claude`, `API key`, `API keys` in English; everything else in Hebrew RTL.

---

## Design principles (research-backed)

The brief asks for a "premium and intentional" feel without marketing fluff. These principles, drawn from current pitch-deck, scrollytelling, and RTL design references (see Sources), shape every per-slide recommendation below.

- **One message per slide.** Modern minimalist demo-day decks live in the 5 to 7 slide range, with each slide treated as a single thought and generous whitespace. Our 5-slide target is on-trend.
- **Hierarchy through typography, not chrome.** Bold weights for the kicker and title, lighter weights for body, consistent accent color per slide. Avoid decorative borders or shadows that don't serve a hierarchy.
- **Subtle gradients as accents.** A 1-stop accent gradient on the slide-1 connecting line or the slide-5 roadmap line is acceptable. Don't gradient the slide background; keep the existing soft neutral paper colors.
- **Scrollytelling = progressive disclosure.** Scroll-driven reveals work best when each scroll increment surfaces one new piece of information. Slide 1's pipeline is exactly this pattern: draw the line and reveal one step at a time as the slide enters.
- **GPU-only animations.** GSAP ScrollTrigger guidance: animate only `transform` and `opacity`. For SVG line draws, use `stroke-dashoffset` (composited, no layout cost). Never animate `width`, `height`, `top`, `left`, or `margin`.
- **Respect `prefers-reduced-motion`.** Wrap any new scroll-scrubbed motion in a `@media (prefers-reduced-motion: reduce)` fallback that snaps to the final state immediately.
- **WCAG 2.1 at 400% zoom.** Content must remain usable without horizontal scrolling at 400% zoom. The new 4-card grid on slide 4 must collapse to a single column well before the mobile breakpoint kicks in.
- **RTL is not just text alignment.** In Hebrew, "forward" arrows point LEFT. Any new directional glyph on slide 1 must read right-to-left. Use CSS logical properties (`margin-inline-start/end`, `padding-inline-start/end`, `border-inline-start/end`) on the new 4-card grid so spacing flips correctly without hand-mirrored rules.
- **Symbolic icons (microphone, waveform, film strip, phone frame) do NOT flip in RTL.** Only directional icons flip. Apply this to the slide-1 glyphs and the slide-4 card header icons.
- **Card design: group related info, single internal hierarchy.** Each slide-4 card reads top to bottom: card title -> `כיום` label -> body -> `אפשרות להמשך` / `מה צריך` label -> body. A thin accent rule or a single glyph in the header gives each card personality without breaking grid rhythm.
- **Closing = roadmap, not contract.** Pitch-deck research shows numbered-milestone closings outperform "Questions?" or a price-as-final-slide. The closing should let the speaker fill in pricing verbally while the slide shows the path forward.

---

## Final 5-slide content (source of truth)

This is the copy to paste into both `storySections` (in `index.html.template`) and `slides-content.md`. All copy below is em-dash-free, direct-voice, no price. Hebrew copy is in fenced code blocks so RTL renders predictably across markdown viewers.

### Slide 1 - `intro`

| Field | Value |
|---|---|
| **id** | `intro` (do not change) |
| **visual** | `introPipeline` (do not change) |
| **theme** | paper `#ffffff`, accent `#f9543e` (do not change) |

**kicker:**
```
Weather V1
```

**title:**
```
מקריינות תחזית לסרטון ורטיקלי
```

**lead:**
```
Weather V1 מקבלת קריינות תחזית, מתמללת אותה, מפרקת אותה לסצנות, מתאימה וידאו מהקטלוג, ומייצרת בסיס לסרטון תחזית.
```

**bullets:** _(empty: the visual carries the structure)_

**mobile_bullets:** _(empty)_

**mobile_summary:**
```
קריינות תחזית, תמלול, פירוק לסצנות, רקע מהקטלוג, ובסיס לסרטון תחזית.
```

### Slide 2 - `studio`

| Field | Value |
|---|---|
| **id** | `studio` (do not change) |
| **visual** | `studioDashboard` (do not change) |
| **panelLayout** | `split-visual-heavy` (do not change) |
| **theme** | paper `#f4f3ef`, accent `#c8202b` (do not change) |

**kicker:**
```
סטודיו
```

**title:**
```
המקום שבו נבנה הסרטון בפועל
```

**lead:**
```
הסטודיו הוא מסך העבודה המרכזי של האפליקציה: מעלים קריינות, המערכת מתמללת אותה באמצעות OpenAI, מודל ה־AI מחלק את הטקסט לסצנות ובוחר סגמנטים מהקטלוג, ואז מתבצע רינדור על המחשב והורדה של הסרטון.
```

**bullets:** (count must stay at 4 to preserve the `data-studio-phase-bullet` mapping: upload, transcript, planning, render)
```
העלאת קריינות: מתחילים מקובץ תחזית אחד.
תמלול: המערכת הופכת את הקריינות לטקסט.
תכנון AI: חלוקה לסצנות ובחירת סגמנטים מהקטלוג.
רינדור והורדה: יצירת בסיס לסרטון תחזית והורדה שלו.
```

**mobile_bullets:**
```
העלאת קריינות
תמלול לטקסט
תכנון סצנות
רינדור והורדה
```

**mobile_summary:**
```
הסטודיו הוא המקום שבו נבנה הסרטון בפועל: מקריינות לתמלול, מתכנון סצנות לבחירת סגמנטים, ואז רינדור והורדה.
```

### Slide 3 - `catalog`

| Field | Value |
|---|---|
| **id** | `catalog` (do not change) |
| **visual** | `catalogScreenshot` (do not change) |
| **panelLayout** | `split-visual-heavy` (do not change) |
| **theme** | paper `#f4f6fb`, accent `#3d55b8` (do not change) |

**kicker:**
```
קטלוג
```

**title:**
```
הקטלוג: המקום שבו מסדרים את חומרי הווידאו
```

**lead:**
```
הקטלוג מרכז את חומרי הווידאו בצורה מסודרת. כיום יש בו כ־200 סרטונים, שלאחר חלוקה לסגמנטים הופכים לכ־400 קטעים קצרים שהמערכת יכולה לבחור מהם בזמן יצירת הסרטון.
```

**bullets:**
```
כל סרטון בקטלוג מחולק לסגמנטים קצרים.
לכל סרטון יש תיאור כללי ותגיות שמסבירות מה הוא מכיל.
לכל סגמנט יש תיאור ותגיות משלו: מה רואים בו, איזו אווירה יש בו, ולאיזו סצנה הוא יכול להתאים.
התיאורים והתגיות עוזרים למודל ה־AI להבין את חומרי הווידאו ולבחור קטע מתאים לכל סצנה.
הבחירה נעשית לפי משמעות הסצנה, לא לפי שם קובץ אקראי.
```

**mobile_bullets:**
```
כ־200 סרטונים בקטלוג
כ־400 סגמנטים אחרי חלוקה
תיאור ותגיות לכל סרטון
תיאור ותגיות לכל סגמנט
```

**mobile_summary:**
```
הקטלוג מסדר את חומרי הווידאו: כ־200 סרטונים שמחולקים לכ־400 סגמנטים. לכל סרטון ולכל סגמנט יש תיאור ותגיות, כדי שהמערכת תוכל לבחור קטעים לפי מה שרואים בהם ולפי ההקשר של התחזית.
```

### Slide 4 - current state / options

| Field | Value |
|---|---|
| **id** | `local-first` (KEEP this internal id to avoid breaking `#local-first` anchor, scroll registry, GSAP per-slide config, external links) |
| **visual** | `localFirstPitch` (KEEP this routing key; the renderer body is replaced, the dispatch key stays) |
| **panelLayout** | `split-visual-heavy` (do not change) |
| **theme** | paper `#f4f6fa`, accent `#475569` (do not change) |

**kicker:**
```
מצב נוכחי
```

**title:**
```
מה קיים היום ומה אפשר לשנות בהמשך
```

**lead:**
```
כיום Weather V1 עובדת בצורה מקומית לשלב העבודה הנוכחי: הרינדור קורה על המחשב, הקטלוג נשמר בענן פרטי לצורכי פיתוח, והתמלול ותכנון הסצנות משתמשים ב־API keys של OpenAI / Claude. בהמשך אפשר להעביר חלקים מהמערכת לתשתיות שלכם, לפי מה שנכון לכם.
```

**bullets:** _(empty on desktop: the 4-card visual carries the content)_

**mobile_bullets:**
```
רינדור מקומי על המחשב
קטלוג בענן פרטי לצורכי פיתוח
OpenAI לתמלול
Claude / OpenAI לתכנון סצנות
אפשרות להעביר חלקים לתשתיות שלכם
```

**mobile_summary:**
```
כיום Weather V1 עובדת בצורה מקומית לשלב העבודה הנוכחי: הרינדור קורה על המחשב, הקטלוג נמצא בענן פרטי לצורכי פיתוח, והתמלול ותכנון הסצנות משתמשים ב־API keys. בהמשך אפשר להעביר חלקים מהמערכת לתשתיות שלכם לפי הצורך.
```

**4 cards (replace the comparison-table renderer):**

#### Card 1 - `קטלוג`

```
כיום:
הקטלוג שמור בענן פרטי שלי לצורכי פיתוח ובדיקות.

אפשרות להמשך:
להעביר את הקטלוג למחשב, שרת או ענן שלכם, כדי שהחומרים יהיו אצלכם.
```

#### Card 2 - `תמלול`

```
כיום:
התמלול מתבצע באמצעות OpenAI.

מה צריך:
OpenAI API key לצורך תמלול הקריינות.
```

#### Card 3 - `תכנון סצנות`

```
כיום:
קבלת ההחלטות ותכנון הסצנות מתבצעים בעזרת Claude או OpenAI.

מה צריך:
API key מתאים לפי המודל שבו בוחרים להשתמש.
```

#### Card 4 - `רינדור`

```
כיום:
הרינדור מתבצע מקומית על המחשב שבו האפליקציה מותקנת.

אפשרות להמשך:
אם רוצים עבודה מרחוק, מכמה מחשבים או מטלפון, צריך פתרון ענן מתקדם יותר.
```

Note the secondary-block label is **per card**: cards 1 and 4 say `אפשרות להמשך`, cards 2 and 3 say `מה צריך`. Don't normalize them to one label; the distinction is intentional (cards 2 and 3 are about what's required to keep using the existing setup, cards 1 and 4 are about what could move later).

### Slide 5 - how we continue (merged closing)

| Field | Value |
|---|---|
| **id** | `pricing` works (lower diff blast radius, but misleading name) **or** rename to `next-steps` (cleaner semantics, requires anchor audit). Recommendation: rename to `next-steps`. See Open questions. |
| **visual** | New routing key, e.g. `closingRoadmap` (replaces `pricingHero`) |
| **panelLayout** | `split-copy-heavy` works, or switch to `stack-visual-top` if the roadmap visual benefits from full width below the copy |
| **theme** | paper `#f4fcf8`, accent `#0d9488` (existing teal stays nice; a calmer slate is also acceptable) |

**kicker:**
```
המשך
```

**title:**
```
איך ממשיכים מכאן
```

**lead:**
```
אחרי שראינו מה קיים היום, השלב הבא הוא לסגור יחד כמה דברים קטנים כדי להביא את Weather V1 למצב שעובד אצלכם בפועל.
```

**bullets:**
```
להבין מה חשוב לדייק לפני שימוש אמיתי.
להחליט איפה נכון לשמור את הקטלוג בהמשך.
לחבר את ה־API keys הרלוונטיים.
לבדוק את המערכת בסביבת העבודה שלכם.
לסגור יחד את היקף ההמשך בצורה פשוטה וברורה.
```

**mobile_bullets:**
```
מה צריך לדייק
איפה יישב הקטלוג
חיבור API keys
בדיקה אצלכם
סגירת היקף ההמשך
```

**mobile_summary:**
```
שקופית סיום פשוטה: מה צריך לסגור, מה צריך לחבר, ואיך מביאים את Weather V1 למצב שעובד אצלכם בפועל.
```

---

## Visual redesign direction (per slide)

### Slide 1 - warm up the pipeline

Currently `introPipelineFlowHtml()` (template lines ~4709 to ~4724). A flat horizontal row of label spans separated by `←` arrows. Reads as a technical legend.

**Keep:**
- The 5-step concept and order.
- The pure CSS / inline SVG approach (no new image assets).
- The slide accent (`#f9543e`).
- The white paper.

**Change:**
- Stagger the 5 steps along a gentle arc or curve, not a flat row. Let the eye travel.
- Add a small symbolic glyph per step using inline SVG / CSS shapes:
  - Step 1 (קריינות): microphone.
  - Step 2 (תמלול): lines of text.
  - Step 3 (תכנון סצנות): stacked scene cards.
  - Step 4 (התאמת וידאו): film strip.
  - Step 5 (רינדור): vertical phone frame.
  - These are **symbolic**, so they do NOT flip in RTL.
- Add a one-time scroll-in:
  - Draw the connecting line via `stroke-dashoffset` animated from full to zero.
  - Then fade in each glyph with a staggered `opacity` plus `translateY` tween as the slide enters the viewport.
  - Only `transform`, `opacity`, and `stroke-dashoffset` (all GPU/compositor-friendly). Never animate `width`, `height`, `top`, `left`, or `margin`.
- The line direction must read right-to-left: step 1 anchors on the right edge, step 5 on the left edge. Visual flow should match Hebrew reading direction.
- Wrap the animation in `@media (prefers-reduced-motion: reduce) { ... }` that snaps to the final state (line fully drawn, all glyphs visible).
- A 1-stop subtle gradient on the line (`#f9543e` to a slightly lighter shade) is acceptable; adds the "premium" feel without noise.

**Mobile:**
- Collapse to a vertical stack of the same glyphs and labels with a thin vertical guide line.
- No motion on mobile (the slide is already text-summary-only there).
- At 400% browser zoom on desktop, the layout must still fit in a single column without horizontal scroll.

### Slide 2 - studio (light polish only)

Currently `studioDashboardHtml()` (template lines ~4456 to ~4589). Interactive bento mockup, 4 cells, phase highlighted by clicking bullets. This is the strongest visual in the deck.

**Keep:**
- The whole mockup structure.
- The `data-studio-phase-bullet` mapping (upload, transcript, planning, render).
- The iPhone-frame preview that appears in phase 4.

**Change:**
- Copy only (per the new title / lead / bullets above). The bullet count stays at 4 so the phase mapping survives unchanged.
- Optional nice-to-have: a subtle `phase X / 4` indicator next to the bullets so the connection to the mockup is more obvious on first view.

### Slide 3 - catalog (light polish on framing)

Currently `catalogScreenshotHtml()` (template lines ~4603 to ~4627). Two real screenshots, modal opens on button click.

**Keep:**
- Both screenshots.
- The `dialog#catalogTagModal` open-on-button-click interaction.

**Change:**
- Update copy per the new title / lead / bullets (lead leads with the concrete `כ־200` / `כ־400` numbers).
- Tighten the screenshot frame: slightly larger figure caption tying the screenshot to the `תיאור ותגיות לכל סגמנט` bullet. Not a structural change.

### Slide 4 - major redesign: 4 cards replace the comparison table

Currently `localFirstPitchHtml()` (template lines ~4629 to ~4662). A 3-column / 2-row comparison table. Dry and tabular.

**Remove:**
- The whole `<table class="pitch-local-first-compare">` markup.
- The `.pitch-local-first-compare*` CSS rules (no other consumer).
- The `.pitch-local-first-visual--table` variant flag.

**Add: a 2 by 2 grid of 4 cards** (single-column collapse on narrow widths AND at 400% zoom). Each card has one consistent internal hierarchy, top to bottom:

1. Optional symbolic header icon:
   - `קטלוג`: grid or folder glyph.
   - `תמלול`: waveform.
   - `תכנון סצנות`: list of scene cards.
   - `רינדור`: vertical-frame.
   - Symbolic, so does NOT flip in RTL.
2. Card title (large, weight 700 or more, slide accent color `#475569` or a richer slate). Reads on the inline-start side in RTL.
3. Small `כיום` eyebrow label (weight 600 or uppercase, muted) followed by a 1-line paragraph.
4. Thin horizontal divider (subtle, slate at low opacity).
5. Small `אפשרות להמשך` OR `מה צריך` eyebrow label (per card per the content above) followed by a 1-line paragraph.

**Spacing:**
- All card padding and margins use **CSS logical properties** (`padding-inline-start`, `padding-inline-end`, `margin-inline-start`, `border-inline-start`) so the grid flips correctly under RTL without hand-mirrored rules.
- Use `gap` for inter-card spacing (Flexbox/Grid `gap` is direction-agnostic).

**Surface:**
- Card background close to the slide paper (`#f4f6fa`), with a soft 1px border and a tiny shadow for tactility.
- Avoid heavy drop-shadows; this slide should feel calm, not playful.

**Mobile:**
- Cards stack one per row.
- `mobile_summary` plus `mobile_bullets` already convey the same content; the cards themselves are not rendered on mobile (consistent with how visuals are hidden under 860px today).

### Slide 5 - merged closing (replace pricing slot; remove v1-next)

Currently a pricing slide (`pricingHeroHtml()`, template lines ~4664 to ~4677) followed by a text-only `v1-next` slide. Two slides become one.

**Remove:**
- The 6th `v1-next` entry from `storySections` entirely.
- The whole `pricingHeroHtml()` body. The hard-coded `4,000 ₪`, the `דמו מצגת ⋯ לא חוזה` fine print, and the two chips all go.
- The `.pitch-pricing-hero*` CSS rules.

**Add: a numbered roadmap of 5 nodes** (recommended pattern):

- 5 small numbered nodes (1 through 5) connected by a thin accent line.
- Each node shows its bullet text below the number.
- In RTL, node 1 anchors on the right edge, node 5 on the left edge. The connecting line draws right-to-left.
- On narrower viewports (and at 400% zoom), the roadmap collapses to a vertical numbered list with the line running top-to-bottom on the inline-start side.

**Fallback pattern (if the roadmap proves too tall in the available slide height):** a single polished checklist card with 5 ticked items, soft border, no footer chrome. Whichever pattern is chosen, **no amount, no `דמו מצגת ⋯ לא חוזה`, no chips that reference cost**. The slide should leave silence for the spoken pricing conversation.

**Optional scroll-in:**
- As the slide enters, animate the connecting line via `stroke-dashoffset`.
- Reveal nodes with staggered `opacity` plus `transform`.
- Same GPU-only rule and `prefers-reduced-motion` fallback as slide 1.

**Surface:**
- Existing teal accent (`#0d9488`) stays nice. A calmer slate is also acceptable.
- Soft paper (`#f4fcf8`) works.
- A single 1-stop accent gradient on the connecting line is acceptable.

**Mobile:**
- Same numbered list, single column, no decorative card chrome required.
- `mobile_bullets` already provides the short version of each step.

---

## Technical implementation guide

### Files to change

**1. `docs/download-page/index.html.template`**

- **`storySections` array (lines ~4130 to ~4258):** trim from 6 entries to 5. Drop the entry whose `id` is `v1-next`. Rewrite all content fields per the "Final 5-slide content" section above.
- **`introPipelineFlowHtml()` (lines ~4709 to ~4724):** replace the inline-track markup with a curved/staggered layout plus per-step inline-SVG glyphs and a `stroke-dashoffset` line draw. **Keep the function name** so `visualMarkup()` routing (`visual: "introPipeline"`) keeps working.
- **`studioDashboardHtml()` (lines ~4456 to ~4589):** no structural change. Copy updates land in `storySections`.
- **`catalogScreenshotHtml()` (lines ~4603 to ~4627):** light figure caption / framing only.
- **`localFirstPitchHtml()` (lines ~4629 to ~4662):** **replace the table markup with the 4-card grid.** Keep the function name so `visual: "localFirstPitch"` routing still resolves; this avoids touching the dispatch logic.
- **`pricingHeroHtml()` (lines ~4664 to ~4677):** **replace entirely with the new closing visual.** Recommended: rename to `closingRoadmapHtml()` and update the dispatch in `visualMarkup()` to map a new `closingRoadmap` visual key. Alternative (less rename churn but misleading name): keep the function name `pricingHeroHtml` and just change the contents.
- **Inline CSS in the template:**
  - Remove `.pitch-local-first-compare*` rules (no consumer after the swap).
  - Remove `.pitch-pricing-hero*` price/chip rules.
  - Add new rules for the 4-card grid. Suggested class names: `.pitch-current-state-cards` (grid container), `.pitch-current-state-card` (single card), `.pitch-current-state-card__icon`, `.pitch-current-state-card__title`, `.pitch-current-state-card__now`, `.pitch-current-state-card__next`, `.pitch-current-state-card__label`.
  - Add new rules for the closing roadmap. Suggested class names: `.pitch-closing-roadmap`, `.pitch-closing-roadmap__line`, `.pitch-closing-roadmap__node`, `.pitch-closing-roadmap__node-number`, `.pitch-closing-roadmap__node-label`.
  - Use CSS logical properties throughout the new rules.
  - Keep desktop / `@media (min-width: 861px)` parity.
- **Mobile behavior:** `panel-mobile-summary` and `panel-mobile-bullets` already drive what's shown under 860px. No changes to the mobile selector logic; just provide the new mobile copy in the `storySections` entries.

**2. `docs/download-page/slides-content.md`**

- Reduce from 6 slide sections to 5.
- Update the header line ("6 slides" -> "5 slides"). Update the "slide order is intentional" line to the new order: `intro -> studio -> catalog -> current state -> closing`.
- Replace all slide sections with the new content above (kicker, title, lead, bullets, mobile_bullets, mobile_summary).
- Update the **Visual asset glossary** section:
  - Replace the `localFirstPitch` table description with the 4-card description (`קטלוג`, `תמלול`, `תכנון סצנות`, `רינדור`).
  - Replace the `pricingHero` description with the new closing visual description.
  - Remove all references to `4,000 ₪`.
- Update the **Paste-back map** section verification list: "All 5 slides render in order: intro -> studio -> catalog -> current state -> closing."
- Strip `מע״ם` / `מע״מ` mentions entirely (the typo fix becomes moot once pricing is gone).
- Audit `<strong>` usage: the new catalog lead does not require `<strong>` emphasis. Remove the "Slide 3 still renders bold text where the `<strong>` tag is" verification step, and ensure the markdown mirror doesn't claim `<strong>` exists where it doesn't.

**3. `docs/download-page/REDESIGN.md`** (this file)

- The handoff report. Already exists; do not edit during implementation. After the implementation is done and verified, this file can either be deleted or moved into an `archive/` subfolder.

### Files to NOT change

- `scripts/build-download-page.mjs` and `scripts/download-page-dev.mjs`: pure asset/placeholder pipeline; no slide-count awareness.
- `docs/download-page/assets/`: keep all existing assets. No new image assets needed (slide-1 glyphs are inline SVG / CSS).
- Anything under `src/`, `electron/`, `node_modules/`, or `_site/`: the pitch deck is isolated to `docs/download-page/`.

### Slide-count drop: things to audit

Going from 6 to 5 slides:

- **Hash anchors:** each slide id becomes a `#…` anchor. Dropping `v1-next` removes `#v1-next`. If the closing slide is renamed from `pricing` to `next-steps`, `#pricing` also breaks. **Before pushing, grep the repo for `#v1-next` and `#pricing`:**
  ```
  grep -rn '#v1-next\|#pricing' . --include='*.md' --include='*.html' --include='*.txt' \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=_site
  ```
  If any external doc, README, or commit-linked PR description references those anchors, update or call them out in the PR.
- **Step navigation (`.pitch-step-nav`):** renders next/prev based on the `storySections` length; should adapt automatically. Verify after the change.
- **Progress bar (`.scroll-progress` / `#progressFill`):** driven by total scroll length, not slide count; should adapt.
- **ScrollTrigger registry:** per-slide pinning / snap is built from the `storySections` array; should adapt automatically when one entry is removed.
- **Mobile rendering:** each section still renders as its own block on mobile; nothing slide-count-coupled to fix.
- **Catalog modal (`#catalogTagModal`):** belongs to slide 3; unaffected.
- **`PITCH_STUDIO_DEMO` fixture:** belongs to slide 2; unaffected.

### Em-dash sweep

After updating the storySections array and the markdown mirror, grep both files for the U+2014 character and verify zero matches inside visible-copy fields. The em-dash currently appears in renderer-internal strings too (for example, the `pricingHeroHtml` fine print line). Those go away when the pricing visual is replaced. `introPipelineFlowHtml()` does not currently contain U+2014. Concrete check:

```
grep -nP '\x{2014}' docs/download-page/index.html.template docs/download-page/slides-content.md
```

Must return zero matches inside slide copy fields.

---

## What NOT to do

- Do not keep a separate pricing slide.
- Do not write any price, amount, currency, or VAT note.
- Do not write `המחיר יוצג בשיחה`.
- Do not use `התקנה ראשונית`.
- Do not use the em-dash (U+2014) anywhere in copy, in the new card visuals, or in this report.
- Do not say `אצל V1`, `מה V1 צריכים`, or `המערכת אצל V1`.
- Do not turn slide 4 into a technical architecture diagram. No buckets, no infrastructure boxes, no arrows between server icons.
- Do not introduce new image assets for slide 1 (keep it inline SVG / CSS so it stays one self-contained HTML file).
- Do not rename the internal id of slide 4 (`local-first`) unless you also audit every anchor and registry reference.
- Do not remove the studio mockup interactivity.
- Do not animate non-GPU properties (no `width`, `height`, `top`, `left`, `margin` tweens).
- Do not skip the `prefers-reduced-motion` fallback on new scroll-in animations.

---

## Verification checklist

1. `grep -nP '\x{2014}' docs/download-page/index.html.template docs/download-page/slides-content.md` returns zero matches inside `storySections` and inside slide copy fields.
2. `grep -niE '4[,.]?000|₪|מע״?[מם]|התקנה ראשונית|המחיר יוצג בשיחה|אצל V1' docs/download-page/index.html.template docs/download-page/slides-content.md` returns zero matches.
3. `npm run download-page:build` succeeds; `_site/index.html` is regenerated.
4. `npm run download-page:dev` serves the page; manual visual pass at desktop width and at <860px confirms exactly **5 slides** render in order: intro -> studio -> catalog -> current state -> closing.
5. The catalog modal still opens and closes on the button click (slide 3).
6. The studio mockup still responds to bullet clicks across all 4 phases (slide 2).
7. The scroll progress bar fills end-to-end across all 5 slides.
8. Step navigation buttons (`.pitch-step-nav`) advance through 5 slides without overshoot.
9. Mobile view (DevTools, <860px) hides all visuals and shows the new `mobile_summary` plus `mobile_bullets` for each slide.
10. Browser zoom at 400% on a 1280-wide viewport: no horizontal scrolling appears on any slide. The slide-4 4-card grid collapses to a single column gracefully (WCAG 2.1).
11. With OS-level "Reduce motion" enabled (or DevTools "Emulate prefers-reduced-motion: reduce"), slide 1 and slide 5 render in their final state without an animated entrance.
12. Slide 1 connecting line and any directional arrows read right-to-left (visual flow matches Hebrew reading direction). Symbolic glyphs (microphone, waveform, etc.) are NOT mirrored.
13. Repo-wide grep for `#v1-next` and `#pricing` returns no orphaned anchor references in tracked docs.

---

## Open questions to resolve before pushing

1. **Closing slide internal id:** keep `pricing` (lower diff blast radius, misleading name) or rename to `next-steps` (cleaner semantics, requires anchor audit)? **Recommendation: rename to `next-steps`.** Ask the manager if any link points to `#pricing` before changing.
2. **External link audit:** are there any emails, Slack messages, READMEs, or commit-linked PR descriptions currently pointing to `#pricing` or `#v1-next`? Grep the repo and surface findings to the manager in the PR description.
3. **Slide 1 animation intensity:** the manager hinted at "more alive". The recommended pattern is a single one-time scroll-in (line draw plus staggered glyph reveal). **No loops, no infinite animations.** Confirm this is the right intensity, or dial it down to a pure static SVG if the manager prefers zero motion.
4. **Slide 4 card icons:** the symbolic header glyphs (catalog / waveform / scene cards / vertical-frame) are recommended for visual rhythm. They are optional. If the manager prefers a cleaner card with no icons, drop them; the rest of the card hierarchy still works.
5. **Slide 5 visual pattern:** numbered roadmap is the primary recommendation. Confirm before building. The checklist-card fallback exists for height constraints.

---

## Sources

The design-principles section draws on these references. Keep them in this report so future updates have a starting point.

- [11 Presentation Design Trends for Startup Pitch Decks in 2026 - Visible.vc](https://visible.vc/blog/startup-presentation-design-trends/)
- [Pitch Deck Design: Proven Visual Strategies for Stunning Slides - Qubit Capital](https://qubit.capital/blog/pitch-deck-design-principles)
- [Minimalist Storytelling: Craft a Pitch Deck That Resonates - Master RV Designers](https://www.masterrvdesigners.com/guides/ultimate-guide-to-pitch-deck-design-trends/minimalist-storytelling-for-maximum-impact/)
- [Scrolling Designs: 8 Patterns and When to Use Each (2026) - Lovable](https://lovable.dev/guides/scrolling-designs-patterns-when-to-use)
- [Mastering GSAP ScrollTrigger - A Complete Practical Guide - DEV Community](https://dev.to/vishwark/mastering-gsap-scrolltrigger-a-complete-practical-guide-5bi3)
- [ScrollTrigger - GSAP Docs](https://gsap.com/docs/v3/Plugins/ScrollTrigger/)
- [The Complete Guide to RTL (Right-to-Left) Layout Testing - Placeholdertext](https://placeholdertext.org/blog/the-complete-guide-to-rtl-right-to-left-layout-testing-arabic-hebrew-more/)
- [CSS Logical Properties Guide - Unwired Learning](https://unwiredlearning.com/blog/css-logical-properties)
- [Creating Animated SVG Timelines and Process Flows - SVGenius](https://svgenius.design/blog/creating-animated-svg-timelines-and-process-flows)
- [Roadmap Slide Pitch Deck Best Practices and Examples - OpenVC](https://www.openvc.app/blog/roadmap-slide)
- [How to End a Pitch Deck So Investors Take Action - InkNarrates](https://www.inknarrates.com/post/how-to-end-a-pitch-deck)
