# 24 — Household Sharing

## This reopens a locked call — deliberately

docs/01's MVP scope table lists `households` under "Deferred," docs/02/03
scope the sync partition to `user_id` only, and docs/05 states plainly:
"Household/shared accounts — this model is single-user per account." All
three are being reopened here at the user's explicit request (2026-08-14),
not silently. Where this doc's design conflicts with earlier text, the
earlier doc gets an amendment note pointing here rather than being rewritten
in place, so the history stays legible.

## The problem

Two (or more) people want to share one financial picture — accounts,
categories, transactions, budgets — while each keeps using the app on their
own device(s), online or off. Critically: sharing data is not the same as
merging identities. Each transaction still needs to say **who actually paid**
for it, independent of whose device logged it.

## Household & membership model

```sql
create table households (
  id          uuid primary key,
  name        text,
  created_at  timestamptz not null default now()
);

create table household_members (
  household_id  uuid not null references households(id),
  user_id       uuid not null references users(id),
  joined_at     timestamptz not null default now(),
  primary key (household_id, user_id)
);
```

Every user gets an implicit personal household (household of one) the
moment they'd otherwise get a bare `user_id` under the old model — on first
sync-enable for the PowerSync path (docs/05), or on first successful P2P
pairing for the free path (docs/25). This makes "connecting two people"
just a **merge of two existing households into one**, not a special
first-time-only flow — the same operation whether it's your own second
device or someone else's.

## `household_id` replaces `user_id` as the sync partition key

`accounts`, `categories`, `transactions`, and `budgets` each gain a
`household_id` column. This is the column sync rules and API validation
partition on going forward (see amendments to docs/02/03 below);
`user_id`-as-tenant is retired from those four tables.

## Payer, creator, and owner are three different things

The user's original ask was specific: track who paid, "not who created the
record." Sitting with that distinction surfaced a third one worth keeping
separate too:

| Column | Table | Mutable? | Meaning |
|---|---|---|---|
| `paid_by_user_id` | `transactions` | yes, editable any time | Whose money this was. The field originally requested — what the budget-vs-payer reporting is built on. |
| `created_by_user_id` | `transactions` | no, set once at insert | Who logged the row. Provenance/audit trail — e.g. Alice enters a transaction Bob actually paid for. Also sets up attribution for docs/04's still-deferred learning loop, whenever that gets built. |
| `owner_user_id` | `accounts` | yes, editable in the account edit form | Whose payment instrument this is. Shown as a label ("Alice — Visa") **only** once a household has 2+ members; solo households render exactly as today, no UI change. |

Both new `transactions` columns are `not null references users(id)`.
Existing rows backfill `created_by_user_id = paid_by_user_id = user_id`
(the pre-sharing sole owner is the obvious default for their own history).

`owner_user_id` on `accounts` backfills to the account's current `user_id`
at migration time, and defaults to the creating user for any account made
after.

## What sharing explicitly does *not* do

Per the user's own framing: track and report by payer, nothing more. No
balance/settlement computation ("Bob owes Alice $42"), no split rules, no
debt-marked-settled UI. If that's wanted later it's a materially bigger
feature layered on top of `paid_by_user_id` — the column is there, the
math isn't.

## The merge algorithm

Triggered once two devices agree to connect (docs/25 covers how that
agreement happens — pairing code + signaling; this section covers what
happens to the data once they have). Runs as one atomic operation, not a
background reconciliation.

**Assumes the two sides are actually different people.** docs/25's
"own device vs. someone else's" fork (D125-D127, added 2026-08-14) resolves
*whose* identity a device's rows carry before this algorithm ever runs —
pairing your own second device unifies identity instead of running this
merge as a two-person household. Everything below is the "someone else's"
path.

1. **Categories — merge by `id`.** Seed categories already use fixed,
   deterministic slugs (`cat-food`, `cat-housing-rent`, ...) — see
   `app/src/lib/seed.ts`. `insert ... on conflict (id) do nothing` naturally
   collapses two installs' identical seeded taxonomy into one row per
   category. User-created categories have random (non-colliding) IDs, so
   they just get re-pointed to the merged `household_id` as-is.
2. **Accounts — never merged, always moved.** Each user's own bank
   accounts are distinct real-world things; two people's "Checking" are not
   the same row. Requires a fix first: `seed.ts` currently gives accounts
   fixed slug IDs too (`acc-visa`, `acc-checking`, ...) — the exact same
   pattern as categories, but wrong for accounts specifically, since it
   means two fresh installs' default accounts collide on merge instead of
   coexisting. Needs to switch to generated IDs (matching how
   user-created accounts already work) before this ships.
3. **Transactions — moved.** `household_id` updated, nothing else changes;
   `account_id`/`category_id` stay valid since accounts are moved
   (not re-keyed) and matching categories share the merged ID. Same
   fixed-slug problem as accounts turned out to apply here too: `seed.ts`'s
   demo transactions (`tx-1`...`tx-5`) used fixed IDs — two freshly-seeded,
   not-yet-really-used installs merging (a plausible first-run scenario
   for a couple setting the app up together) would otherwise collide row
   IDs and silently drop one side's transaction to last-write-wins. Fixed
   alongside accounts, D113.
4. **Budgets — the one real collision, and only the real one.**
   `unique (household_id, category_id, month, currency)` means two
   pre-existing budgets for the same category+month+currency now collide
   once merged into one household. Resolution: keep one row,
   `amount_cents = greatest(a, b)`, drop the other. Matches the user's own
   call — take the higher goal
   rather than prompting a reconciliation UI.

## Tier inheritance

Once any household member has a paid subscription, the **whole household**
gets PowerSync/cloud sync access — paid status is a household-level
property once merged, not a per-member patchwork. The actual Stripe
mechanics (who's billed, what happens if the paying member leaves or
downgrades, whether a second member can independently subscribe) are
explicitly **not** designed here — deferred to whenever docs/06 gets
revisited for this feature, per the user's own call to leave billing out of
this pass.

## Sync rules (amends docs/03)

```yaml
bucket_definitions:
  household_data:
    parameters: select hm.household_id as household_id
                from household_members hm
                where hm.user_id = request.user_id()
    data:
      - select * from accounts     where household_id = bucket.household_id
      - select * from categories   where household_id = bucket.household_id
      - select * from budgets      where household_id = bucket.household_id
      - select * from transactions
        where household_id = bucket.household_id
          and occurred_on >= (now() - interval '18 months')
```

A user can belong to more than one household in principle (the membership
table doesn't prevent it), but v1 UI only ever creates/uses one at a time —
multi-household switching is out of scope, not designed.

## API validation (amends docs/03's write path)

`/api/sync/upload`'s "row belongs to user" check becomes "row's
`household_id` is one the requester is a member of" — a join against
`household_members` instead of a direct `user_id` equality check.

## Open questions

- Billing mechanics for a shared subscription — deferred to docs/06, per
  the user's call.
- Household leave/unmerge — not designed. Today this is a one-way merge;
  splitting a household back apart isn't covered.
- Duplicate non-seed categories with the same name (e.g. both users
  independently created a custom "Streaming" category before merging) are
  **not** deduped — only exact seed-ID matches merge. Two "Streaming" rows
  would coexist post-merge. Flagged, not solved.
- Multi-household membership (one user in two shared households at once)
  is possible in the data model but has no UI story.
- Standalone "merge account" action (not just the pairing-time flow) for
  reconciling two datasets that grew up separately — including two already
  -paid users combining into one household, which reopens the billing
  question above in a sharper form (two active subscriptions, one
  household). Flagged 2026-08-14, tracked in docs/00-backlog.md, not
  designed.

## Decisions locked in this doc

| # | Decision | Why |
|---|---|---|
| D108 | Reopen docs/01/02/03/05's "households deferred / single-user per account" calls | Explicit user request 2026-08-14; earlier docs get amendment notes, not silent rewrites |
| D109 | `household_id` (not `user_id`) becomes the sync partition key on `accounts`/`categories`/`transactions`/`budgets`; every user gets an implicit personal household | Makes "connect two people" the same operation as "connect my own second device" — one mechanism, not a special case |
| D110 | Three distinct columns: `paid_by_user_id` (mutable), `created_by_user_id` (immutable), `owner_user_id` on accounts (mutable) | Payer, logger, and instrument-owner are genuinely different facts; conflating them loses information the user specifically asked to keep |
| D111 | Sharing is track-and-report only — no balance/settlement/split computation | Matches what was actually asked for; settlement math is a materially bigger feature not being designed here |
| D112 | Merge algorithm: categories merge by matching seed `id`, accounts always move (never merge), transactions move, budget collisions resolve to `greatest(amount_cents)` | Reuses the fact that seed categories already have deterministic IDs; treats accounts as real-world-distinct by construction; matches the user's explicit call on budget conflicts |
| D113 | `seed.ts` must switch **account, transaction, and budget** IDs from fixed slugs to generated IDs — categories (and `category_keywords`) deliberately keep theirs | Two fresh installs' seeded accounts/transactions would otherwise collide and incorrectly unify/overwrite on merge (unlike categories, where identical seeded content *should* collapse into one row). Budgets specifically need this too: a shared fixed id would let plain last-write-wins silently pick a side instead of the intended `greatest(amount_cents)` rule from D112, since LWW keys off row id, not the `(category_id, month, currency)` collision the merge rule actually cares about. Broader than first scoped when this doc was drafted — caught while implementing. Implemented 2026-08-14 in `app/src/lib/seed.ts`, verified with `tsc -b`/`oxlint`/Playwright. |
| D114 | Paid tier is inherited household-wide once any member is paid; exact billing mechanics deferred to docs/06 | User's explicit call; keeps this doc scoped to the data model, not Stripe details |

**Partially implemented, 2026-08-14.** The local-only-safe slice of the
data model is real: `owner_user_id` (`accounts`), `paid_by_user_id`/
`created_by_user_id` (`transactions`), all backed by a new
`app/src/lib/identity.ts` (`getLocalUserId()` — the docs/05 D11
client-generated user_id, never previously implemented since nothing
needed it before this). Populated on every insert path (seeding, quick-add,
typed/voice entry, account creation) and backfilled on read for any
pre-existing row. Verified with `tsc -b`/`oxlint` and a live Playwright
pass reading actual row values back out of SQLite, not just checking the
UI doesn't crash. `db/schema.sql` mirrors the same three columns for
consistency (no FK to `users`, matching `user_id`'s own existing
convention in that file).

**Deliberately not done in this pass**: `household_id` on any table —
`schema.ts`'s own stated principle ("a single device's local DB only ever
holds one user's data... add sync-partition columns when sync begins, not
before") applies to `household_id` exactly as it did to `user_id`, so it
stays out of the local schema until there's an actual second household
member to partition against. Also not done: the `households`/
`household_members` Postgres tables, sync rule changes, API validation,
the merge algorithm's actual code, and any UI surface for
owner/payer/creator (correctly invisible per D110 until a household has
2+ members).
