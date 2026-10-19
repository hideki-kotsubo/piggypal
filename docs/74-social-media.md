# 74 — Social media channels and posting pipeline

Flowtab on Instagram, Facebook, TikTok, Threads, LinkedIn and the rest:
how the accounts are set up, how posts are written and reviewed in four
languages, and how they go out on a schedule. Discussed and built
2026-10-18 on `feat/social-media`.

## The pipeline

```
app/CHANGELOG.md ──► social:from-changelog ──► marketing/posts/<date>-<slug>.md
weekly Claude routine (D280) ─────────────────►        (en · pt-BR · es · fr)
                                                         │  you review, fill approved:
real app (dev server) ──► social:screenshots ──┐         ▼
                                               ├──► social:compose ──► marketing/out/posts/<id>/<lang>-{feed,story}.png
                                               │                        + <lang>-caption.txt
                                               │         ▼
                                               │    upload images (MEDIA_BASE_URL)
                                               │         ▼
                                               └    social:publish --send ──► Ayrshare ──► networks
                                                    (records marketing/published.json)
```

| Command | What it does |
| --- | --- |
| `npm run social:screenshots [-- --url U --lang L --size store --theme dark]` | Fresh install per language in headless Chromium, types six everyday entries through the real parser, captures 7 screens to `marketing/out/screenshots/<lang>/`. Default URL `http://localhost:3001`. |
| `npm run social:compose [-- <post-id>]` | Renders each post into a 1080×1350 feed image and a 1080×1920 story image per language, plus the caption as text. |
| `npm run social:compose -- --profile` | Avatar (1080²) and covers: Facebook, YouTube, LinkedIn, X. |
| `npm run social:from-changelog -- 0.7.0 [date]` | Draft `update` post from a changelog release, English only. |
| `npm run social:publish [-- --from D --days N --send]` | Dry run by default; `--send` schedules approved posts. |

`marketing/out/` is git-ignored (all of it is regenerated). The posts,
`channels.json` and `published.json` are committed.

**Run screenshots and compose on the Mac.** The app uses system fonts
(Charter, SF), so on this Linux server the app screenshots render with
fallback fonts. They're fine for checking the flow, not for publishing.
The post templates load the website's Google Fonts and look the same anywhere.

## Decisions

**D272 — One handle everywhere, reserved now.** Same handle on Instagram,
Facebook Page, TikTok, Threads, YouTube, LinkedIn page, X, Bluesky and
Reddit, including the ones not used yet. It shouldn't contain the domain,
which may still change (docs/61). Instagram must be a Business or Creator
account linked to the Facebook Page, and TikTok a Business account; no
scheduling API can post otherwise.

**D273 — One main account per network, in English.** Four languages ×
six networks would be 24 accounts for one person. English posts go to the
main accounts. A pt-BR second account on Instagram/TikTok is the first
candidate (the user reviews pt-BR and has the Brazilian community);
es and fr get their own only once analytics show traction.
`marketing/channels.json` maps each language to an account; `null` means
none yet, and those languages are skipped at publish time. Profile images
and banners are English, for the main accounts.

**D274 — A post is one Markdown file with all four languages.** Format in
`scripts/social/posts.mts`; start from `marketing/posts/_TEMPLATE.md`.
Templates: `feature` (headline + phone screenshot), `update` (headline,
three bullets, screenshot), `tip` (text only). Every claim must be true
today, same rule as the website (docs/61 D232). In particular, the native
apps aren't in the stores yet, so no "download on the App Store".

**D275 — Nothing publishes without a per-language approval.** `approved:`
lists the languages cleared to go out; drafts from scripts or Claude leave
it empty. The user approves en and pt-BR; es and fr need a native reviewer
first, the same rule as the app's translations (docs/73).

**D276 — French is Canadian French first.** The Canadian market is the
reason for French (Vancouver, en + fr), so post copy uses Québec usage
("souper", "épicerie", "magasiner") and the screenshots use fr-CA.
French amounts take a non-breaking space before `$` (`4,50 $`).

**D277 — Screenshots come from the real app, not mockups.** Each language
gets a fresh browser profile with its language, locale and timezone set,
and its entries are typed in that language, so the parser, categories,
currency and date formats in the screenshots are the real ones. The same
script with `--size store` (440×956 @3x = 1320×2868) makes the App Store
6.9" and Play phone screenshots that docs/66 and docs/70 still need.

**D278 — Ayrshare as the publishing layer, behind one function.** Direct
platform APIs are a trap for one person: Meta needs app review for
publishing, TikTok only allows private posts until an app audit, and X's
API is paid. Ayrshare (one `POST /api/post` with `platforms`,
`mediaUrls`, `scheduleDate`; Profile-Key per extra account) does this
work for us. Swapping to Publer, Buffer or another service means rewriting
`schedule()` in `publish.mts` and nothing else. Media must be at public
https URLs: upload `marketing/out/posts/` to an Azure Storage container
(see "Hosting the images") and set `MEDIA_BASE_URL`. **The adapter is
untested**: no account existed when it was written. Do the first `--send`
with one post and check it in Ayrshare's dashboard.

**D279 — TikTok and YouTube Shorts need video.** Image posts skip them,
with a note in the dry run. Next step for those two: short screen
recordings of real entries, captioned per language (Playwright can record
video of the same flow as the screenshots), or templated clips. Videos
with a face and voice perform best; that part is the user's.

**D280 — A weekly Claude routine drafts, the user approves.** Every Friday
a scheduled Claude session reads `app/CHANGELOG.md`, `marketing/posts/`
and this doc, and adds the next week's three posts (Tue/Thu/Sat, 09:00
Pacific) in all four languages with `approved:` empty, on a branch.
The user reviews (5–10 minutes), fills `approved:`, merges, and runs
compose + publish. The prompt is `marketing/ROUTINE.md`. Not set up
yet: it needs this branch merged and pushed so a cloud session can
clone it.

## Content plan

Cadence: three posts a week, Tue/Thu/Sat at 09:00 Pacific. Three good
posts a week beat a daily AI post, which tends to get little reach and
can look like spam. Rotate five themes:

1. **Product updates.** From the changelog (`social:from-changelog`).
2. **How-tos.** Typed and voice entry, split purchases, scheduled
   payments, household sharing, multi-currency.
3. **Money tips.** Arithmetic and habits, not financial advice: no
   investment, tax or debt recommendations.
4. **Building in public.** One person in Vancouver building a budgeting
   app. Real photos beat the text template here.
5. **Community.** Brazilians, Latin Americans and francophones in Canada;
   travel and living in more than one currency.

First two weeks (written 2026-10-18, all `approved:` empty):
`2026-10-20-type-it-or-say-it`, `2026-10-22-v0-7-0`,
`2026-10-24-four-languages`, `2026-10-27-small-spends`,
`2026-10-29-every-day-added-up`, `2026-10-31-built-in-vancouver`.
The last one speaks in the user's own voice (Brazilian, Vancouver,
spending in several currencies, why the app exists); it needs their check
before anything else.

## Hosting the images

Example with Azure Storage (the user's cloud). One-time setup: a storage
account with a public-read container named `social`. Then, after each
compose:

```
az storage blob upload-batch --account-name <account> --destination social --source marketing/out/posts --overwrite
```

`MEDIA_BASE_URL=https://<account>.blob.core.windows.net/social`

## Release checklist addition

After `deploy-app.sh` releases a version with user-visible changes:
`npm run social:from-changelog -- <version>`, edit the draft, translate,
approve, compose, publish.

## Found while building

The screenshot run exercises the real app in four languages, and turned up
these:

1. **Parser bug: the starter keyword "99" matches inside amounts.**
   `seed.ts` seeds `99` (the Brazilian ride app) for Rideshare, and user
   keywords match as substrings, so "netflix 16.99", "coffee 9.99" or
   "gas 199" match Rideshare as well and go to the inbox as ambiguous.
   Fixed separately on `fix/parser-99-keyword`.
2. **Insights' trend chart is hardcoded to CAD** (`TrendSparkline.tsx`
   `PRIMARY_CURRENCY`). A user spending in reais sees "Últimos 30 dias
   (CAD) $ 0,00". Not fixed.
3. **A fresh install defaults to CAD whatever the locale**
   (`store.tsx`, last used currency or `'CAD'`), so a new user in Brazil
   sees CAD until they type "R$" once. Not fixed.
4. **The entry placeholder is cut off in pt-BR and fr at 390px** ("digite
   ou fale o que você ga…"). Not fixed.
