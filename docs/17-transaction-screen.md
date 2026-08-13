# 17 — Dedicated Transaction Screen

## The problem

Every edit surface in this app so far (`AccountsScreen`, `CategoriesScreen`,
and `TransactionEditForm` itself) uses the same inline expand-in-place
pattern: tap a row, a panel opens right below it. That's a deliberate
convention (docs/12, docs/14) — but for transactions specifically it ran
into a real problem: tap-entry (docs/07 D22–26) creates a transaction with
only amount, category, account, and currency set — Note, Location
(docs/15), and Date/Time default to "now"/blank and are only reachable by
scrolling back to find the row in Recent and tapping it open. In practice
this meant tapping straight back into a just-created transaction to add
those fields almost every time — not an occasional edit, a near-mandatory
second step that the inline pattern made harder than it needed to be.

## Scope for this pass — Transactions only, not a global convention change

This is a deliberate divergence for **transactions specifically**.
`AccountsScreen` and `CategoriesScreen` keep their existing inline
expand-in-place editing unchanged — this doc doesn't touch them and isn't
a precedent for changing them.

## A real route, not a bigger inline panel

`TransactionList.tsx` and `RecentList.tsx` both used to hold local
`editingId` state and conditionally render `TransactionEditForm` inline.
Both now render each row as a plain `<Link to={`/transactions/${t.id}`}>`
instead — `TransactionScreen.tsx` (new) reads `:id` from the route, looks
the transaction up in `store.transactions`, and renders the *same*
`TransactionEditForm` component unchanged, wrapped in a screen shell
(app-bar + back link) matching every other screen's header. No changes
were needed inside `TransactionEditForm` itself — it already had every
field (account/currency, amount, category, date/time, note, location).

## Back navigation: `navigate(-1)`, not a fixed route

Every other screen's back-link points at one hardcoded parent route
(`CategoriesScreen` → `/settings`, `InboxScreen` → `/`, etc.) because each
is reachable from exactly one place. `TransactionScreen` isn't: it's
reachable from the Transactions list, Home's Recent list, *and* straight
from tap-entry (below). A fixed target would be wrong from at least one of
those. Its back button is a `<button onClick={() => navigate(-1)}>`
instead, styled identically to every other screen's `.back-link` (that
class gained a small button-chrome reset so it renders the same whether
it's backing a `<Link>` or this `<button>`).

## Tap-entry lands here instead of toasting

`EntryZone.tsx`'s `submitTap` (the fast amount-pad + category-chip flow,
still exactly as fast as before — no new fields shown before submit) used
to call `onSubmitted('Added', undoFn)`, showing a 5-second toast with an
undo action. It now calls `navigate(`/transactions/${tx.id}`)` right after
inserting instead, landing the user on this new screen with
amount/category/account/currency/date-time already set and Note/Location
one tap away — exactly the "I always click back into it anyway" step,
just automatic.

The toast+undo is dropped for this path specifically, not replaced with
anything: the screen's own "Delete transaction" action (existing confirm
dialog) already covers undo, and the toast would be visually cut off
mid-navigation regardless (`App.tsx` owns toast state and unmounts it on
route change). Typed/voice entry (docs/16) keeps `onSubmitted`'s
toast+undo as-is — it doesn't get an auto-navigate behavior in this pass,
so the two `EntryZone` submit paths now genuinely differ in their
post-submit UX by design, not by oversight.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D80 | Transactions get a dedicated `/transactions/:id` screen, replacing inline expand-in-place, for transactions only — Accounts/Categories unchanged | Note/Location/Date-Time were only reachable by scrolling back to find the row; a bigger inline panel doesn't fix that, a direct landing spot does |
| D81 | Back navigation uses `navigate(-1)`, not a hardcoded parent route | The screen is reachable from three different places now, unlike every other screen's single fixed entry point |
| D82 | Tap-entry auto-navigates to the new transaction's screen instead of toasting; typed/voice entry keeps the toast+undo | Directly answers the "click back into it right after creating" pattern without slowing tap-entry itself down; the two entry paths intentionally diverge in post-submit UX |
| D83 | No separate lightweight undo was built for the auto-navigate path | The screen's own "Delete transaction" action, already built, already covers it |

**Implemented 2026-08-12.**
