# 21 — The Sunken Zone: a Shared Card Pattern

## The problem

The Home entry box (`.entry-zone`: sunken fill + hairline border + 16px
radius) is a real, named pattern, but nobody had written it down as one.
Three more full copies of it existed independently, each at a different
literal radius — `.account-create` (16px), `.search-input-row` (12px),
`.text-input` (10px) — and three more did a *partial* version, border and
radius but no sunken fill: `.trend-card` (14px), `.goal-box` (10px),
`.picker-group` (12px, dashed). Nothing shared code or a name, so each new
component re-derived the values by eye rather than picking a tier on
purpose.

## The rule

The sunken treatment signals "this is a zone you act inside" — a group of
unlike controls (input, keypad, chips) working together as one unit. A
flat, divider-separated list signals "this is a list you scan," which is
most of the app (Accounts, Transactions, Settings rows). Boxing every row
of a list wouldn't extend the pattern, it would flatten it — "sunken" only
reads as a signal because most of the app isn't. So the box stays reserved
for zones; list screens are confirmed flat on purpose, not audited and
left inconsistent.

## The fix

- `tokens.css` gained a radius scale: `--radius-lg` (16px, zones),
  `--radius-md` (12px, inline zones), `--radius-sm` (10px, atomic) —
  theme-independent, defined once in the base `:root`.
- `.entry-zone` and `.account-create` now use `--radius-lg`;
  `.search-input-row` uses `--radius-md`; `.text-input` uses `--radius-sm`.
  Same visual result as before, now expressed as a named tier instead of a
  literal each component picked independently.
- `.trend-card` and `.goal-box` promoted to full tier: both already had
  the border+radius half of the pattern, just missing the sunken fill —
  added `background: var(--surface-sunken)` to each, and moved their
  radius onto the scale (`--radius-md` / `--radius-sm` respectively,
  matching their existing 14px/10px within a rounding step).
- `.picker-group` kept its dashed border and un-sunken (`--surface`, not
  `--surface-sunken`) fill exactly as-is — only its radius literal moved
  onto `--radius-md` (a no-op, it was already 12px).
- No JSX/component changes — every change is CSS-only, either a literal
  swapped for a token or one declaration added to an existing rule.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D101 | The sunken-card treatment (fill + border + radius) is reserved for "zones" — components grouping several unlike controls into one interactive unit — not for list rows | Keeps the pattern meaningful as a signal; boxing every row of Accounts/Transactions/Settings would read as noise and work against the "simple, light" positioning (docs/01) |
| D102 | Radius formalized as tokens: `--radius-lg` (16px), `--radius-md` (12px), `--radius-sm` (10px) | The four existing full-tier components had four different literal radius values with no shared reasoning between them |
| D103 | `.trend-card` and `.goal-box` promoted to full tier (sunken fill added) | Both already carried the border+radius half of the pattern; the missing fill made them read as a different, lesser component by accident rather than by design |
| D104 | `.picker-group`'s dashed border and un-sunken fill left unchanged, not promoted to full tier | Dashed already means "expanded/temporary" elsewhere in the account picker; filling it in would erase that second signal |

Superseded/related: none — this doc only touches shared visual tokens,
not any screen's structure or data flow.

**Implemented 2026-08-13.**
