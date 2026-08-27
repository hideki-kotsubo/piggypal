# 47 — Admin/ops panel: a fully separate environment

## Why

Every real support/debug moment so far (docs/45's seven sign-in bugs, the
stuck-PowerSync-upload-queue bug, checking whether a signup actually
landed) has meant querying production Postgres by hand. This is a
dev-only diagnostic tool for the owner — never a customer-facing surface,
not a household "manager" role (that's a separate, already-deferred idea,
see docs/24/26's owner/payer UI). Requested 2026-08-24.

## Locked decisions

| D | Decision | Rationale |
|---|---|---|
| D171 | The admin panel is a **brand-new, separate git repository** — not a workspace inside this monorepo | User's explicit call: strongest isolation, admin code can never accidentally import/depend on client (`app/`/`api/`) code, and its own repo means its own access control independent of who has access to this repo |
| D172 | Admin backend and frontend **never call `api/`'s HTTP endpoints** — no shared API surface with the client app at all | User's explicit call. Whatever the client's `api/` exposes to end users is a strictly separate trust boundary from what the admin tool can do (e.g. impersonation-adjacent lookups, direct data correction) — sharing endpoints would mean designing every client route to also be safe for admin power, or vice versa |
| D173 | Admin backend connects to the **same production Postgres**, but through its **own DB role**, scoped separately from `api/`'s `piggypal` role (docs/39, `deploy/powersync/README.md`) | The whole point is inspecting live data — a separate database would break that and add real sync/replication complexity for no benefit. A separate role keeps blast radius contained: compromising one service's credentials doesn't automatically hand over the other's grants, and the two roles can carry genuinely different permissions (admin likely needs broader read access than a normal client should ever get; client `api/` needs write paths admin has no reason to have) |
| D174 | Admin auth is its own system: a dedicated `admin_users` table, password (bcrypt/argon2) + **required** TOTP second factor | User's explicit call over reusing docs/41's magic-link pattern. No email-sending dependency, standard shape for a small-headcount tool with full data access. Explicitly not: SSO, hardware keys, IP allowlisting — none ruled out as a *later* hardening layer, just not v0 |

## What's still open (not designed yet)

- **New repo's name/location** — not decided. Needs to exist on GitHub
  before anything else here is actionable.
- **`admin_users` table location** — logically it must live in the same
  Postgres as everything else (there's only one production database,
  D173), but it's a new table with no `user_id`/`household_id`
  partitioning concerns like the client's tables — schema not drafted.
- **The admin DB role's actual grants** — "own role, least-privilege" is
  locked (D173); the actual GRANT statements (which tables get SELECT,
  which get UPDATE/DELETE for real support actions like force-clearing a
  stuck sync state) are not. Needs a first-pass list of what v0's screens
  actually need before granting anything.
- **v0 feature scope** — real candidates from actual past incidents, not
  yet prioritized or committed to a first cut:
  - User/account lookup by email (signup status, `getAuthAccount`
    state).
  - Sync/device diagnostics: PowerSync upload-queue depth per device,
    last successful sync timestamp — the exact visibility gap that made
    docs/45 bug #4 (stuck queue) slow to diagnose.
  - Refresh-token/session inspection — docs/41 already built theft-signal
    whole-chain revocation; nothing today lets a human *see* a user's
    active sessions.
  - Subscription status — blocked on docs/06 (Stripe) existing at all;
    natural home for it once built, not before.
- **Deployment** — a new subdomain (matching the existing pattern:
  `app.piggypal.codexbase.dev`, presumably something like
  `admin.piggypal.codexbase.dev`), nginx-proxy-manager entry, and
  whether it runs on the same Docker host as PowerSync Service
  (docs/39) or elsewhere. Not decided.
- **2FA enrollment/recovery flow** — TOTP is locked (D174) but losing the
  second factor with no recovery path locks the owner out of their own
  ops tool; needs at least a documented break-glass procedure (e.g. a
  server-side reset script), not necessarily more UI.

## Explicitly not in scope here

- Anything customer-facing. If "admin" ever means a household member
  managing other members, that's docs/24/26's owner/payer model, a
  completely different feature with different audience and trust
  boundaries — not this doc.
- Multi-admin / role-based permissions within the tool itself — v0 is
  built for exactly one operator (the owner). Worth flagging if a second
  admin user is ever added for real, not designed preemptively.
