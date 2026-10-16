# 72 — Account deletion, App Review sign-in, iPhone-only

2026-10-15. Clears three of docs/66's App Store blockers (1, review
sign-in, 4). Built the same day. API verified against a throwaway PGlite
Postgres (31/31); screen checked in headless Chromium at iPhone size,
light and dark, including a real deletion through the web cookie path.
Not yet run on a phone or through the real PowerSync Service.

## Choices made with the user before building

- Only the account **owner** can delete it.
- The device that deletes **keeps its local data** and carries on
  without an account, like signing out.
- Confirmation by **typing DELETE**.

## D257 — In-app account deletion

App Review guideline 5.1.1(v): an app that lets people create an account
must let them start deleting it inside the app. Email-only deletion (what
the privacy policy said before) is a common rejection.

**Scope.** One account is the whole household (docs/48: one login,
several profiles). Deleting it removes the synced data for every person in
it. That's why only the owner can do it.

**Owner.** The profile whose id is `users.id` itself: the device that
first signed up (docs/05 D11), plus any device that later picked that
profile in the sign-in picker. App side: `getLocalUserId() ===
authAccount.userId`. Others see "Only <owner> can delete it".

**Endpoint.** `POST /api/auth/delete-account` (access token required).
The device proves which session it is with its own refresh token (the
cookie on the web, the body from the native apps, docs/68). That token's
`device_id` must have a synced `devices` row whose `profile_id` is the
owner. 401 without a live session for this account, 403 for a
non-owner device. This stops a household member by accident. It isn't a
hard boundary against a member who forges the owner's device id at sign-in,
but they already see all the data anyway.

One transaction, in foreign-key order: `transaction_splits`,
`transactions`, `budgets`, `category_keywords`, `scheduled_payments`,
`accounts`, `categories`, `devices`, `profiles` (all `where user_id`), then
`device_link_codes`, `refresh_tokens`, `subscriptions`, the email's
`magic_links`, and `users`. A hard delete, straight away. Backups roll
off within 30 days, as the privacy policy says.

**Other devices.** Their refresh tokens are gone, so they drop to "Sync
paused — sign in again" (docs/68 D244) once their access token expires.
Until then, `requireAccessToken` now checks that the user still exists
(one indexed lookup per authenticated request), so a leftover access token
can't upload rows that would bring the account back. A household device
that's online and streaming while the account is deleted gets the
deletions through PowerSync and loses its local copy; the screen warns
about this. A device that's offline keeps its copy.

**This device.** `DeleteAccountScreen` (`/settings/delete-account`, a
danger row under Sign out) calls `disconnectSync()` first, so the
deletions never stream down here, then `deleteAccount()` (`lib/auth.ts`).
If the call fails, sync reconnects and the error is shown. On success the
refresh token and the "signed in" marker are cleared, and the data stays.
Signing up again later with the same email works and reuses the same id,
so the local data uploads into the new account.

Privacy policy section 6 now describes the in-app path (email stays as a
second route). Effective date moved to 2026-10-15.

## D258 — Review sign-in with a fixed code

App reviewers can't read our email, so they couldn't get the 6-digit code
(docs/56 D204). `REVIEW_EMAIL` + `REVIEW_CODE` (api env, both required,
code must be 6 digits): a sign-in request for that one address stores the
fixed code's hash instead of a random one and sends no email. Everything
else is the normal path: the 15-minute expiry, the 5-wrong-tries limit,
and account creation on first use. Unset means off. If the reviewer deletes
the review account, the next sign-in just creates it again.

## D259 — iPhone-only for v1

`TARGETED_DEVICE_FAMILY = 1` (was `"1,2"`) in both build configurations.
The UI is a 480px phone column; with iPad on, iPad screenshots are required
and review tests on an iPad. iPads can still run the iPhone app in
compatibility mode.

## D260 — Other household devices learn the account is gone

Found by the user testing on two phones: after the owner deleted the
account, a household member's device showed "Signed out on this device —
Sign in again", "Waiting to upload 8 changes" and the Household row, as if
the account still existed. The deletion had wiped its refresh token, so
the server only saw an unknown token, the same as a revoked one (docs/68
D244).

- **Tombstone.** `deleted_accounts (user_id, deleted_at)` (migration
  `2026-10-15-deleted-accounts.sql`), written by the delete in the same
  transaction. It holds only the random account id and a time. It's
  removed if that id signs up again (the owner re-signing with the same
  email reuses it).
- **Refresh** now sends the account id the device thinks it's in
  (`userId`, from the "signed in" marker). An unknown token plus a deleted
  id → 401 with `code: 'account_deleted'`. Every other unknown-token case
  is unchanged. It only answers for an exact random UUID the device
  already had. `requireAccessToken` adds the same code for a deleted
  user's access token.
- **App.** `refreshAccessToken()` handles that code (`handleAccountDeleted`):
  it forgets the token, clears the marker, stops sync (`db.ts` registers
  through `onAccountDeleted`, since `auth.ts` can't import `db.ts`), and
  stores a notice with the email. Local data and the upload queue stay,
  the same as a sign-out. Settings shows "The account … was deleted by its
  owner" with an OK to dismiss, and Home's banner says "Your account was
  deleted — this device now works without sync". Signing in again clears
  the notice.
- **`useAuthAccount()` is now one shared store** (`useSyncExternalStore`),
  not a `useState` copy per component. Without that, a screen already open
  (Settings) kept showing "Signed in" after a sign-out that happened
  outside it.

The code is detected the next time the device refreshes: when the app
opens, on "Sync now"/"Reconnect", or when sync's access token runs out.
A device whose account was deleted *before* this change has no tombstone,
so it stays at "Sign in again"; Sign out clears it.

Verified: api on throwaway PGlite started on the previous schema and
applied the migration itself, 37/37 (adds the code with the right hint,
plain 401 without a hint / with a live account / with a bad id, tombstone
written and cleared on re-signup, and the code on a live access token).
Headless Chromium with three "phones" on one account: the owner deletes;
a member with Settings open taps Sync now and switches in place to the
note plus the sign-in form (no "Signed in", "Waiting to upload" or
Household rows); the Home banner shows, and OK clears both; a member who
opens the app afterwards is signed out on load with the banner, and its
local accounts are still there.

## Not done here

- `ITSAppUsesNonExemptEncryption` in `Info.plist` (docs/66 blocker 5):
  that's the user's export-compliance answer, given in App Store Connect
  first.
- Production `CORS_ORIGIN` (docs/66 blocker 3): on the production server.
- Google Play's web deletion-request page (docs/70).

## Verified

- API (throwaway PGlite, 31/31): the review address gets no email, takes
  the fixed code (spaces allowed) and rejects a wrong one, and other
  addresses still get random codes. For deletion: refused without an
  access token, without a refresh token, or with another account's token;
  a non-owner household device gets 403 and nothing is deleted. The owner
  deletes every row of every table above, and an unrelated account and the
  review account are untouched. Afterwards a member's live access token is
  refused on upload and on `powersync-token` (no rows come back), refresh
  is a 401, a second delete is a 401, and the same email can sign up again.
  Web owner deletion through the cookie also clears the cookie.
- Browser (headless Chromium, iPhone size): the Settings row is there; the
  button stays disabled until DELETE is typed (any case). A network failure
  shows a readable error and stays signed in. The non-owner and signed-out
  views work. A real deletion shows the done state, clears the marker, the
  server rows are gone, and the local accounts are unchanged.
- `tsc` (api, app), oxlint (no new warnings), 127/127 unit tests,
  `vite build`.
