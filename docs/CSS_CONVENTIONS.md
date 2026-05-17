# CSS Conventions (renderer)

The styling source of truth is `src/app/globals.css`. Renderer components must
reuse canonical class names from that file. New BEM `__`-style class names
without matching CSS in `globals.css` will render unstyled — there is no
component-scoped CSS module fallback in this codebase.

## Before adding a class name to JSX

1. Grep `src/app/globals.css` for an equivalent name or a name that already
   covers the visual behavior you want.
2. If absent, decide explicitly:
   - Extend the existing pattern (preferred — add a rule under the matching
     section of `globals.css` and reuse it elsewhere).
   - Introduce a new named pattern (rare — name it after its role, not its
     position; add a comment block in `globals.css` explaining when to use it).
3. Never invent ad-hoc names that mirror an existing pattern under a different
   spelling. Inconsistency is the cost; future grep-and-rename is the bill.

## Canonical patterns

| Concern | Pattern |
| --- | --- |
| Modal | `modal` (overlay) → `modal-backdrop` + `modal-dialog` (optionally `modal-dialog--wide` / `modal-dialog--settings`) → `modal-header` / `modal-title` / `modal-subtitle` / `modal-close` / `modal-body` / `modal-footer` |
| Form field | `field` wrapping `field-label` + bare `textarea` / `select` / `input` (the `.field textarea, .field select` rule styles them) |
| Catalog detail body | `detail-form-grid` + `detail-segments` + `detail-footer` (`detail-footer .btn--primary` is coral) |
| Segment row | `segment-block` (grid: thumb / header / desc / tags) with `segment-thumb`, `segment-header`, `segment-time`, `segment-conf`, `segment-desc-input`, `segment-tags-input`, `tag-pill`, `tag-pill__remove`, `segment-tag-add` |
| Buttons | `btn` + `btn--primary` (coral) / `btn--secondary` (bordered) / `btn--danger` (red) / `btn--ghost` (outlined) / `btn--sm`. `btn--confirm` adds the pulse animation used for two-step destructive confirms |
| Inline error | `error-banner` (inside `modal-body` or panels) |

BEM `__`-style names (`modal-overlay`, `modal__header`, `field-group`, `field-input`, `segments-list`, `segment-row__*`) are **not** part of the convention and have no CSS — components using them render unstyled.

### Plan preview: segment explanations

The Studio **Plan** tile and **למה הקליפים האלה?** panel show why each catalog row was chosen. Timeline picks carry two strings:

- **`picker_reason`** — optional, set **before** `validateAndSwap` from the picker LLM's `reason` field. Editorial Hebrew sentence (weather/shots matching the narration).
- **`reason`** — mutable; the validator overwrites it with technical messages when it swaps segments (`validator: …`). The UI prefers `picker_reason` when present (`pickDisplayReason` in `src/client/lib/plan-pick-display.ts`).

## When this guide applies

Editing files matching:

- `src/app/**/*.tsx`
- `src/client/**/*.tsx`
- `src/app/globals.css`

Server, electron, scripts, and infra code do not need this guide.
