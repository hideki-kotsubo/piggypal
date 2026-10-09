# 61 — Website refresh

`website/` was built before the app launched and had drifted: "coming
soon" with a waitlist form that went nowhere, an "Insights" section
showing features the app doesn't have (forecasts, weekday/weekend
analysis, subscription detection), a paid "Online AI entry" that isn't
built, no scheduled payments, the pre-v2 logo, and share-preview URLs on
the old `piggypal` host. Refreshed 2026-10-09.

## Decisions (asked and answered 2026-10-09)

| # | Decision | Why |
|---|---|---|
| D230 | The call to action is **"Open Flowtab"** (the web app) plus install hints; the waitlist is gone | The app is live; the form had no backend anyway |
| D231 | Pricing shows the free plan as what's real today and **Flowtab Sync** as "coming later", no price | Matches docs/01's free/paid split without claiming billing or AI entry that don't exist |
| D232 | Every feature claim on the site must be true of the app today | The old page had drifted into describing mockups |
| D233 | The website lives at `<domain>` and the app at `app.<domain>`. The domain is `myflowtab.com` today (app: `https://app.myflowtab.com/`), and may move to `flowtab.it` | One search-and-replace switches the repo (below); the user confirmed the convention 2026-10-09 |

## What the page is now

- **Hero:** "Type it or say it. It's on the tab." with the typing demo.
  The demo's phrases are written the way speech recognition actually
  transcribes them (`aluguel 2300 reais`, not "dois mil e trezentos").
- **The range that matters:** the $4.25 → $9,800 log scale, kept from the
  old page, now with a vertical version under 640px.
- **Scheduled payments:** new section, recurring + installments (docs/57)
  with a mock "Coming up" card and a budget bar showing spent vs
  committed (D213).
- **What's in it today:** nine features, all checked against the docs
  and code (bilingual parser, per-currency totals, offline, budgets and
  trend chart, split across accounts, search and filters, household
  pairing, opt-in sync, install).
- **Pricing**, then **Start in your browser** with install steps for
  iPhone and Android/desktop.
- Footer: What's new, the app, contact (the same `mailto:` the app's
  About screen already publishes).

## Structure

- `website/site.css`: shared tokens (brand v2 palette, light and dark),
  nav, buttons, footer. Used by `index.html` and by the generated
  `changelog.html` (its template in `scripts/build-changelog.mts` now
  has the same nav and footer).
- Accent text uses `--flow-ink` (`#0a6f59` light, 5.7:1 on the paper
  colour; `#5fe3bb` dark); the bright gradient is only for fills and
  buttons, with dark text on it (7.6:1 or more).
- `scripts/build-website-assets.mjs` regenerates `logo.png`, `icon.png`,
  `favicon.png`, `apple-touch-icon.png` and `og-image.png` from
  `docs/logo/`, like the app's brand script (docs/60).

## Switching the domain

```bash
sed -i 's#app\.myflowtab\.com#app.NEW-DOMAIN#g; s#myflowtab\.com#NEW-DOMAIN#g' \
  website/index.html scripts/build-changelog.mts
npm run changelog
```

Then remove the `noindex` meta from `index.html` and the changelog
template once the public domain is live, so search engines can find it.

A domain move also touches things outside the repo, on the production
server and DNS:

- DNS and nginx for `<domain>` (website) and `app.<domain>` (app), plus
  the api and PowerSync hosts.
- `deploy/.env`: `APP_BASE_URL` (magic-link emails point here),
  `CORS_ORIGIN`, `COOKIE_DOMAIN`.
- `app/.env.production.local`: the api / PowerSync / relay URLs, then
  rebuild the app.
- `app/public/.well-known/` (docs/54): served from `app.<domain>`; the
  native apps' Associated Domains / App Links must name it too.
- Old links: redirect the old domain to the new one, since magic-link
  emails already sent point at it.

## Verified

Screenshots (headless Chromium, installed 2026-10-09 with the user's OK)
at 1280px and 390px, light and dark, of both pages. They caught four bugs,
all fixed and re-checked: amounts rendering left of their labels (grid
auto-placement), an invisible SVG gradient (bounding-box units on a
zero-height line), the scale chart cut off on phones, and the paid plan's
price line.

## Open

- Sign-in sync works today without paying; the page lists it as a free
  feature and as part of the future Flowtab Sync plan. Decide what
  existing users keep when billing arrives (docs/06).
- App Store / Google Play badges once the native apps are listed.
- A privacy policy page: both stores require one.
