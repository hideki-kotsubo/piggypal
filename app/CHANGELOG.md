# What's new in Flowtab

<!--
How to write an entry (docs/59):

- Write the next release's notes under "## Unreleased", at the top.
  Don't guess the version: scripts/deploy-app.sh turns the heading into
  "## 0.3.0 — 2026-10-12" when you release, and refuses to release
  without notes (pass --no-changelog for a silent release).
- Write for people who use the app, not for developers: what they can
  now do, or what works better. Skip refactors and internals.
- An optional short paragraph, then "- " bullets. **Bold** is the only
  formatting. Indent a line to continue the bullet above it.
- The same text is shown in the app (About → What's new), on the
  website's changelog page, and printed at release for the App Store
  and Play Store release notes.
-->

## 0.3.5 — 2026-10-10

- **Fixed**: in the iPhone and Android apps, sync no longer stops a while
  after you sign in. If you were signed in before this update, sign in
  once more in Settings and it stays signed in from then on.
- If sync ever needs you to sign in again, Flowtab now says so on the
  home screen instead of quietly keeping your entries on the phone.

## 0.3.4 — 2026-10-10

- **Fixed**: on iPhone, the top of the screen no longer sits under the
  clock and status icons.

## 0.3.1 — 2026-10-09

- **A fresh new look**: a new Flowtab icon on your home screen, and a
  matching splash screen.

## 0.3.0 — 2026-10-09

The first public version of Flowtab: a simple, private way to keep track
of what you spend.

- **Type it or say it**: "coffee 4.25" or "almoço 32", in English or
  Portuguese, and Flowtab fills in the amount, category, account and
  date for you to confirm.
- **Works offline**: everything is stored on your device first, so it's
  fast and works without a connection.
- **Every currency side by side**: log each expense in the currency you
  paid in. Totals are kept per currency, never converted.
- **Accounts and categories your way**: group accounts by bank, and
  organise categories into groups.
- **Budgets and insights**: monthly budgets per category, and a trend
  chart of how this month compares.
- **Find anything**: search your expenses and filter by category,
  account, place or date.
- **Split a purchase** across two or more accounts.
- **Scheduled payments**: rent, bills and installment plans show up when
  they're due, and count towards your budgets ahead of time.
- **Share with your household**: pair two phones with a QR code to
  combine your expenses.
- **Sign in with your email** to keep your data in sync across your
  devices.
- **Install it** on your phone or computer, straight from the browser.
