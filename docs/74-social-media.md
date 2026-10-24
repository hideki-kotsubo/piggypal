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
https URLs: see "Hosting the images" (D281). **The adapter is
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

## Accounts

**D283 — The accounts as created (2026-10-23).** Handle `myflowtab`
wherever it was free; display name **Flowtab** everywhere. The website
footer ("Follow" row, every page) and the homepage's Organization
structured data (`sameAs`) list the live ones; update both when this
table changes.

| Network | Account | Notes |
| --- | --- | --- |
| TikTok | [@myflowtab](https://www.tiktok.com/@myflowtab) | Personal account: Business now requires company registration documents, which a sole proprietor doesn't have. Full music library, which suits video. |
| X | [@myflowtab](https://x.com/myflowtab) | |
| Bluesky | [@myflowtab.com](https://bsky.app/profile/myflowtab.com) | Domain handle, via a `_atproto` TXT record on myflowtab.com. |
| LinkedIn | [company/myflowtab](https://www.linkedin.com/company/myflowtab/) | Admin: the user's personal profile, which lists Founder, Flowtab. |
| Facebook | [facebook.com/myflowtab](https://www.facebook.com/myflowtab) | Page under the user's personal Facebook. |
| Reddit | [u/flowtab](https://www.reddit.com/user/flowtab), [r/flowtab](https://www.reddit.com/r/flowtab/) | u/myflowtab belongs to an unrelated 18+ account. Not posted to by `social:publish`; promotion happens from the user's own account, disclosed. |
| YouTube | [@myflowtab](https://www.youtube.com/@myflowtab) | Brand Account channel under `flowtabit@gmail.com` (Google wouldn't verify another account with the user's phone). Public contact `social@myflowtab.com`. |
| Instagram | **disabled by Meta** on 2026-10-23, one day after sign-up | Automated, no review offered. Next: one appeal through Meta's help form; then, if refused, create it from Meta Business Suite under the Facebook Page, on the phone, no VPN, waiting a few days before switching to Business. `myflowtab` stays held by the disabled account: plan for `flowtabapp`. |
| Threads | not yet | Follows Instagram. |

The login email is `social@myflowtab.com` everywhere except YouTube.
Birthdays are the user's real one (identity checks compare them).

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

**D281 — Images are served from `social.myflowtab.com`.** The scheduling
API takes public `https://` links, not uploads, and the networks fetch the
image from the link when posting. A subdomain on the production server
serving a plain folder (no git checkout) keeps them apart from `website/`,
so a website deploy can't remove them, gets its own cache and robots
headers, and can move to a bucket or CDN later by changing DNS only.
Generated images are never committed. Supersedes the Azure Storage
example this section had before (2026-10-19).

One-time setup on the production server:

1. DNS: `social.myflowtab.com` → the production server.
2. `mkdir -p /var/www/social` and an nginx server block:

   ```
   server {
       server_name social.myflowtab.com;
       root /var/www/social;
       autoindex off;
       location / {
           try_files $uri =404;
           add_header X-Robots-Tag "noindex" always;
           add_header Cache-Control "public, max-age=31536000, immutable";
       }
   }
   ```

3. Certificate: `certbot --nginx -d social.myflowtab.com`. Plain http is
   rejected by the networks.

After each compose, from the machine that ran it:

```
rsync -av marketing/out/posts/ <user>@<prod-server>:/var/www/social/
```

`MEDIA_BASE_URL=https://social.myflowtab.com`. `publish.mts` checks every
image with a HEAD request before scheduling.

`immutable` means an image must never change at the same URL: to fix an
image after uploading it, rename the post file (new id, new URL) or drop
`immutable`. Posts already published don't matter, the networks keep
their own copy. A domain move adds this host to docs/61's checklist.

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
