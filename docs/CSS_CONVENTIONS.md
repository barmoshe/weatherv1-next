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

### Modals

`modal`, `modal-backdrop`, `modal-dialog`, `modal-header`, `modal-title`,
`modal-body`, `modal-close`, `modal-footer`.

### Forms

`field` + `field-label`. Inputs are bare `<input>`, `<textarea>`, `<select>` —
they pick up styling from the parent `field`. Do not wrap inputs in
custom-named containers.

### Segment editor (catalog)

`segment-block`, `segment-thumb`, `segment-header`, `segment-time`,
`segment-desc-input`, `segment-tags-input`.

### Buttons

`btn` + exactly one of `btn--primary`, `btn--secondary`, `btn--danger`,
`btn--ghost`. Size modifier: `btn--sm`. Buttons without `btn` will not pick
up the base styles.

## When this guide applies

Editing files matching:

- `src/app/**/*.tsx`
- `src/client/**/*.tsx`
- `src/app/globals.css`

Server, electron, scripts, and infra code do not need this guide.

## Why this exists separately

Earlier this rule lived inside `AGENTS.md` as a long paragraph. It was moved
here so non-renderer work (server, electron, infra, docs) does not pay the
context cost of loading CSS guidance on every session.
