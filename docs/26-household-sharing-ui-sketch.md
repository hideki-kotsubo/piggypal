# 26 — Household Sharing: UI Sketch for Payer/Owner/Creator

## The problem

docs/24 D110 locked three columns — `paid_by_user_id`, `created_by_user_id`
(both on `transactions`), `owner_user_id` (on `accounts`) — but explicitly
left their display undesigned: "correctly invisible per D110 until a
household has 2+ members" was as far as that doc went. Before any of
docs/24's still-unbuilt `households`/`household_members` tables or docs/25's
pairing flow exist, there was no answer to the basic question: once two
people are actually sharing data, what does either of them *see*
differently on Home, on a transaction, on Accounts?

## The sketch

`docs/artifacts/piggypal-household-sharing.html` — four frames, same
phone + numbered-pin + legend format as the pre-build sketches for docs/07,
12, 13, and 15 before them:

1. **Recent list** — a small circular payer badge per row: filled/accent
   means paid by you, outlined means paid by the other member. Reuses
   `.chip.picked`'s existing accent-fill convention rather than inventing a
   per-person color palette. Absent entirely for solo households — no
   layout shift below 2 members, matching D110 exactly.
2. **Transaction edit screen** — "Paid by" renders as a chip row, tap to
   change, matching `paid_by_user_id`'s mutability. "Logged by Bob ·
   yesterday, 6:42pm" renders as italic caption text with no tap target,
   matching `created_by_user_id`'s immutability.
3. **Accounts list** — `owner_user_id` shown as a name prefix in the same
   visual slot the institution label already occupies ("Alice — Visa"),
   taken directly from docs/24's own worked example. An unset owner
   (nullable) degrades to today's unprefixed look, not a placeholder.
4. **Settings → Household** — a bare read-only members list (badge + name),
   just enough to say who the badges elsewhere refer to. No invite/pair/
   leave actions drawn — that surface belongs to docs/25, still fully
   undesigned there too.

## What this doc is not

Not a data-model change — docs/24's columns are untouched. Not an
implementation — no component, JSX, or schema file was edited, only the
standalone mockup. Not a pairing or settlement design — docs/24's own
stated boundaries (no balance/settlement math, no per-person color system
decided) carry into the sketch unchanged, and the artifact repeats them in
its own "not in scope" callout so the boundary travels with the mockup.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D121 | Payer indicator is a filled/outline circular badge reusing the app's existing accent = mine / neutral = not-mine convention (`.chip.picked`, `.pill-tap.active`), not a new per-person color palette | A real multi-person color system is a separate, bigger decision (doesn't scale cleanly past 2 people, needs its own design pass); reusing what already exists answers "whose is this" without making that call prematurely |
| D122 | `paid_by_user_id` renders as a tappable chip row; `created_by_user_id` renders as plain italic caption text with no tap target | Mirrors D110's mutable/immutable split at the interaction level, not just the data level — an editable fact gets an editable control, a provenance fact doesn't |
| D123 | `owner_user_id` renders as a name prefix in the account row's existing name slot ("Alice — Visa"), not a separate line or badge | Matches docs/24's own worked example verbatim; reuses the row's existing institution-prefix visual pattern instead of adding new layout |
| D124 | The only new Settings surface sketched here is a minimal read-only "Household" members list; invite/pairing/leave flows are explicitly left to docs/25 | Keeps this sketch scoped to "how shared data displays," not "how two devices connect" — a different, still-undesigned problem |

**Sketch only, not implemented.** No component/JSX/schema changes. This is
the target to build against once docs/24's `households`/`household_members`
tables and docs/25's pairing flow actually exist — the same relationship
docs/15's location-field sketch had to docs/16-18 before those shipped.

**2026-08-14.**
