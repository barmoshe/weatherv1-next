# Vision: Localization (i18n / l10n)

> Status: vision / discovery, research-grounded. No translation tooling or schema proposed. Sibling docs: [`TEMPLATES.md`](TEMPLATES.md), [`AI_NATIVE_PIPELINE.md`](AI_NATIVE_PIPELINE.md), [`UX_DIRECTION.md`](UX_DIRECTION.md), [`PRODUCT_DIRECTION.md`](PRODUCT_DIRECTION.md), [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md), [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md), [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md), [`DISTRIBUTION.md`](DISTRIBUTION.md), [`ECOSYSTEM.md`](ECOSYSTEM.md).

## Scope

This doc owns **what is different per locale at the content and pipeline level**: transcript language, voice synthesis, taxonomy translation (or non-translation), editorial conventions, fonts, bidi in burned-in captions, locale-aware prompting, UI string tooling. Conditional on the product going beyond Hebrew — until that direction lands, treat as planning ahead.

It does **not** cover: the UI shell's mixed-direction *display* rendering ([`UX_DIRECTION.md`](UX_DIRECTION.md) owns RTL+LTR shell mechanics), template-author tooling ([`ECOSYSTEM.md`](ECOSYSTEM.md)), model-provider strategy beyond per-language quality ([`MODEL_STRATEGY.md`](MODEL_STRATEGY.md)), or the template concept itself ([`TEMPLATES.md`](TEMPLATES.md)).

## Why this exists

WeatherV1 is Hebrew throughout: UI, transcript, voiceover, captions, on-screen graphics, taxonomy. If a second template ever ships in a different language — a Hebrew briefing, an English explainer, an Arabic news brief — the assumption "Hebrew is the source language and everything else is a translation" silently breaks. Treating localisation as a first-class concern at the template level (not the shell level) keeps the platform honest as the language matrix grows.

## i18n vs. l10n is a lifecycle distinction, and conflating them costs you

**i18n** is the one-time engineering investment that makes a product *capable* of being localised — externalising strings, isolating locale-sensitive formatting, allowing 20–30% text expansion, avoiding string concatenation. **l10n** is the recurring content work of adapting to a specific locale. If i18n is skipped, every locale becomes a fork ([Crowdin — i18n vs l10n](https://crowdin.com/blog/internationalization-vs-localization), [Playful Programming — dev guide](https://playfulprogramming.com/posts/building-for-the-world-developers-guide-to-i18n-and-l10n/)).

Modern stacks lean on **CLDR** (the authoritative locale data repo for date/number/currency rules) and **ICU** (the formatting runtime), with `Intl.MessageFormat` standardising the ICU MessageFormat syntax in JS engines ([Crowdin — ICU guide](https://crowdin.com/blog/icu-guide), [Phrase — ICU guide](https://phrase.com/blog/posts/guide-to-the-icu-message-format/), [Lokalise — ICU guide](https://lokalise.com/blog/complete-guide-to-icu-message-format/)).

## Whisper is broadly usable for Hebrew / Arabic but no longer best-in-class

Whisper large-v3 cut errors 10–20% versus v2 across many languages; English real-world WER lands ~10.6%, but Semitic languages and tonal/non-Latin scripts trail. Specialised Hebrew fine-tunes (`ivrit-ai/whisper-v2-d3-e3`, "Whisper Hebrish" for English-Hebrew code-switching) materially outperform stock Whisper on Hebrew. AssemblyAI Universal-2 (6.8% multilingual WER, 30% fewer hallucinations than Whisper-v3), Deepgram Nova-3 (real-time multilingual across 10 languages), and Azure (140+ languages) are now competitive or better for non-English ([Whisper large-v3 card](https://huggingface.co/openai/whisper-large-v3), [Whisper Hebrish](https://huggingface.co/blog/danielrosehill/whisper-hebrish), [AssemblyAI benchmarks](https://www.assemblyai.com/benchmarks)).

**Practical rule: don't assume one ASR provider is best across your locale matrix. Declare per-locale.** Which model wins where, and how it's pinned, is owned by [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md); this doc only says the choice has to be per-locale.

## Voice synthesis: cross-language cloning has a specific failure mode

ElevenLabs (70+ languages, leading cloning) and Azure Neural TTS (140+ languages) are the broad-coverage leaders; Google TTS (125+) and PlayHT (142) extend further; Cartesia Sonic 3 is the latency leader (~90 ms TTFA) but only ~15 languages; OpenAI TTS and Google currently don't ship voice cloning ([Voice generation models 2026](https://sureprompts.com/blog/voice-generation-models-compared-2026)).

A producer's cloned voice *can* speak Hebrew or Arabic, but ElevenLabs explicitly warns the clone **retains its source-language accent and pronunciation artefacts unless source samples include the target language** ([ElevenLabs — cross-language cloning](https://help.elevenlabs.io/hc/en-us/articles/14888891373841-Can-I-clone-my-voice-in-a-language-other-than-English)).

**Implication for templates: a template that uses voice cloning must declare per-locale source samples, not assume one English clone works everywhere.**

## Taxonomy is locale-specific, not translatable

This is the load-bearing point of this doc. "שרב" is a Mediterranean meteorological phenomenon (>27 °C, >5 °C above annual average, humidity 10% below normal, often Saharan dust) with farming and cultural connotations; in Israeli vernacular it's usually called "hamsin" (Arabic loan). "Heatwave" is a near-miss, not a translation ([Anglo-List — hamsin](https://anglo-list.com/hamsin-dust-storms/), [Ulpan La-Inyan — heatwave](https://ulpan.com/how-to-say-heatwave-in-hebrew/)).

Compare Tasty's regional cuisine tags or BBC's region-specific news tags: **each locale gets its own controlled vocabulary, with optional cross-references for analytics.** Brand names typically stay untranslated for the same reason ([Untranslatable words — Lara](https://blog.laratranslate.com/untranslatable-words-cultural-meaning/), [NN/g — crosscultural design](https://www.nngroup.com/articles/crosscultural-design/)).

**The right design treats taxonomies as parallel vocabularies, not as keys with translations.** A weather template in Hebrew has its own taxonomy; an Arabic version is a separate taxonomy, not a translation of the Hebrew one. Cross-template analytics may map them, but the runtime doesn't.

## Templates declare locale-sensitive editorial defaults

Date and number formats, currency, units (°C vs. °F, km vs. mi), time-of-day phrasing ("בערב" vs. "evening"), and **register** (Hebrew has formal/informal; Japanese has keigo/teineigo/casual; Arabic has MSA vs. dialectal) all vary.

ICU MessageFormat handles plurals, gender selection, and number/date skeletons cleanly. What it does **not** model is register, which must be a **template-declared parameter** that flows into the LLM prompt and the TTS voice choice.

## Fonts: per-script matrix, embedding licence matters

For embedded use in rendered video output, font licensing is load-bearing — some commercial foundry licences (e.g. Monotype) explicitly forbid embedding in distributed video.

- **Hebrew**: Frank Ruhl Libre (serif, classic), Heebo (sans, Roboto-derived dual-script), Assistant (modern sans).
- **Arabic**: Cairo (geometric headline), Tajawal (dual-script body).
- **CJK** (if extending East): Noto Sans CJK (SC/TC/JP/KR are separate font files, not glyph subsets).

All four Hebrew/Arabic options above ship under SIL OFL, which permits embedding in rendered video without per-distribution fees ([Heebo on Google Fonts](https://fonts.google.com/specimen/Heebo), [Tajawal on Google Fonts](https://fonts.google.com/specimen/Tajawal)).

**Always declare a fallback chain ending at Noto** to avoid tofu on uncovered codepoints.

## Bidi in burned-in captions: where pipelines break

libass (used by ffmpeg's `subtitles` filter) does Unicode BiDi correctly in modern builds, but historical bugs flipped Hebrew sentence-ending punctuation to the front and produced unshaped Arabic letterforms when complex shaping was disabled ([libass issue #682](https://github.com/libass/libass/issues/682)). ffmpeg's `drawtext` filter requires libfribidi to be compiled in; without it, Arabic renders as disconnected isolated forms ([ffmpeg fribidi patch](https://ffmpeg-devel.ffmpeg.narkive.com/eBOlmKu8/patch-2-2-drawtext-use-libfribidi-to-correctly-render-arabic-text-fixes-ticket-3758)).

Common pitfalls:

- Parentheses and quotes mirroring incorrectly around mixed RTL/LTR runs.
- Brand names like "iPhone 17" inside Hebrew sentences reversing digit order.
- `.srt` files lacking explicit direction marks (U+200E / U+200F) producing different results across renderers.

**Always render a fixture mixing Hebrew + Latin brand + numbers + parentheses as a regression test.** This belongs in the ship-test surface every render template runs through.

## Locale-aware prompting beats English meta-prompts for non-English output

A 2025 study across 35 languages found **matching prompt language to content language improves accuracy up to 50% vs. "translate everything to English"**; machine-translated prompts often dropped below 50% accuracy. Multilingual prompting (running the same task with prompts in several languages and aggregating) increases output diversity and reduces hallucinations on culturally-specific facts ([Ryan Stenhouse — match languages](https://ryanstenhouse.dev/why-your-llm-prompts-should-match-your-content-language/), [Multilingual prompting EMNLP 2025](https://aclanthology.org/2025.emnlp-main.324/)).

**Practical rule for the scene planner: keep the system instructions in English for stability, but localise the *content*-facing portion** (examples, taxonomy vocabulary, style guide excerpts) into the target language.

## UI string tooling: pick by team shape

Crowdin and Lokalise dominate enterprise with deep CI/CD integrations; Phrase is developer-focused with strong CLI/API; Tolgee is the open-source pick with in-context editing; Weblate is Git-native and self-hostable ([Locize — TMS alternatives](https://www.locize.com/compare/)).

For a small team shipping multi-template content, the bigger architectural decision is **ICU MessageFormat over flat key-value** — flat KV breaks on plurals, gender, and select, forcing per-locale code.

**To prevent English drifting as a "first-class" locale, designate a *source* locale per template** (Hebrew for the weather template) and treat all others including English as translations; the TMS workflow then surfaces stale-translation warnings symmetrically.

## Documented localisation disasters and what prevents them

- **HSBC** — "Assume Nothing" became "Do Nothing" across multiple markets; $10M rebrand.
- **KFC China** — "Finger-lickin' good" rendered as "eat your fingers off" in Mandarin.
- **Apple's Hebrew calendar** has shipped multiple locale bugs (calendar language not matching system language; recurring events unable to use Hebrew dates) — chronic edge cases from inadequate locale-coverage testing.

([Translation Excellence — brand fails](https://translationexcellence.com/brands-that-failed-due-to-bad-translation/), [EC Innovations — translation fails](https://www.ecinnovations.com/blog/translation-fails/), [Apple Community — Hebrew calendar bug](https://discussions.apple.com/thread/256041607))

**Prevention pattern:**

- Never machine-translate marketing/brand copy without native review.
- Require a native speaker on the review path for every locale that ships.
- Test fixtures that include real cultural content (a "שרב" forecast, an Arabic-Hebrew code-switched transcript).
- Ban runtime string concatenation in favour of full ICU messages with placeholders.

## Design tensions worth flagging now

- **Source locale per template vs. one canonical source.** Per-template = honest, less concentrated effort; one canonical = simpler tooling, risks one locale being "first-class".
- **Taxonomy translation vs. parallel taxonomies.** Translation = simpler analytics; parallel = honest to domain reality.
- **Voice cloning fidelity across languages.** Use one clone everywhere (cheaper, lower quality) vs. per-locale source samples (better, more work).
- **Whisper-local everywhere vs. best-per-locale.** Local = privacy, cost; best-per-locale = quality.
- **Editorial register declared per template vs. per job.** Per template = consistent voice; per job = adaptive but inconsistent.
- **English as second-class locale.** A Hebrew-first product has to be deliberate about this; English creep is the default failure mode.
- **Where the rendered-caption fixture lives.** Per template (heavy, honest) vs. per platform (light, may miss template-specific bugs).

## Open questions

- Does the second template have to be in a different language to test localisation, or is "Hebrew briefing" a sufficient stretch?
- Who is the native-speaker reviewer for templates the team doesn't author?
- How do templates declare register, and does the agent's planner read it as a constraint?
- Is there a shared brand-name list across templates (untranslated proper nouns) or per-template?
- Do we ship Hebrew + Arabic-capable libass + libfribidi as part of the bundled ffmpeg from day one, or only when the first non-Hebrew template lands?

## Relationship to other future work

- [`TEMPLATES.md`](TEMPLATES.md) — template manifest declares its source locale and register.
- [`MODEL_STRATEGY.md`](MODEL_STRATEGY.md) — per-locale ASR / TTS / vision model choice.
- [`UX_DIRECTION.md`](UX_DIRECTION.md) — RTL+LTR *shell* display (this doc is content, that doc is chrome).
- [`QUALITY_AND_EVAL.md`](QUALITY_AND_EVAL.md) — per-locale eval rubrics; native-speaker reviewer queue.
- [`DATA_AND_CONTENT.md`](DATA_AND_CONTENT.md) — the catalogue's tagging vocabulary, which is locale-specific.

## Non-goals

No translation vendor choice. No proposed message-catalog format. No commitment to ship beyond Hebrew. No multi-tenant SaaS framing.
