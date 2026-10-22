# 76 — Japanese, Korean and Chinese (step 1: the app's text)

2026-10-22. Asked for by the user after docs/73's four languages were live.
Step 1, built the same day on branch `feat/i18n-cjk`, covers everything except
the parser. Step 2 (Japanese parser) was built the same day too; step 3
(Korean, Chinese) is planned below, not built.

## Plan agreed with the user

1. **App text in all four**: Japanese, Korean, Chinese (Simplified),
   Chinese (Traditional). This doc.
2. **Japanese parser** first. It pays for the shared groundwork: matching
   text with no spaces between words, 万-based numbers, and several
   writing systems for one word (昨日/きのう).
3. **Korean and Chinese parsers** on top of that. Korean adds particle
   stripping (커피**를**) and two number systems. Chinese adds "¥" meaning
   yuan rather than yen, 块/元/毛 amounts ("3块5" = 3.50), and every word
   in both scripts. Estimated at about 0.4× and 0.5× of Japanese.

Native-speaker review: the user will ask people to validate all four
before they're announced (2026-10-22).

The yen keypad bug found while assessing this (typing 1 5 0 0 gave ￥15)
was fixed separately first; see docs/10's "Currencies without minor
units".

## Decisions

| # | Decision | Why |
|---|---|---|
| D288 | Add `ja`, `ko`, `zh-Hans`, `zh-Hant` as full UI languages. Chinese is split by script, not region: Traditional is a full file, not a docs/73-style override, because its characters differ throughout. | The user asked for Japanese, Korean and Mandarin and approved both scripts. Taiwan, Hong Kong and Macau read Traditional; mainland China and Singapore read Simplified. |
| D289 | Device detection: `ja-*` → ja, `ko-*` → ko; Chinese goes to `zh-Hant` for `-Hant`, `-TW`, `-HK` and `-MO`, else `zh-Hans`. An explicit script subtag beats the region (`zh-Hans-HK` is Simplified). Intl formatting borrows a Chinese device region only when its script matches. | Script is what a reader needs. A Taiwan region with the Simplified UI shouldn't get Traditional date formats. |
| D290 | Speech for Chinese is always Mandarin: `zh-CN` for Simplified, `zh-TW` for Traditional, never the device's own `zh-HK`. | `zh-HK` selects Cantonese recognition. Cantonese is out of scope for now (the user agreed). |
| D291 | `cadence.weekly1` / `yearly1` / `monthly1` hold the interval-1 wording ("Weekly on Friday", 毎週金曜日), used by `describeCadence()` whenever the interval is 1. | These languages have a single plural form, so the old `_one` variant would never be picked and Japanese would read "every 1 week". The existing languages keep their `_one` keys, and the new keys copy that text. |
| D292 | Traditional Chinese is generated from Simplified with OpenCC (`cn → twp`, Taiwan phrases), then a fixed list of Taiwan terms is applied (登出, 帳戶/帳號, QR Code, 叫車, 點一下, 主畫面, 網路費/電信費, 全螢幕, 權限, 「」 quotes). It still gets its own native review. | Most of the work is mechanical character conversion; the term list covers what OpenCC leaves in mainland style. |

## What step 1 contains

- **Locale files**: `app/src/locales/{ja,ko,zh-Hans,zh-Hant}.json`, 524 keys
  each. Plural groups collapse to `_other`, ordinals to `_ordinal_other`
  (`{{count}}日`, `{{count}}일`), and the parity test checks both.
- **Built from `key = text` sources** by a script that refuses to write
  anything when a key is missing or extra, or when a `{{placeholder}}` or
  `<b>`-style tag differs from English. A second check confirmed that no
  string drops a `{{count}}` the English plural form has.
- **Glossary** (one word per concept):

  | en | 日本語 | 한국어 | 简体 | 繁體 |
  |---|---|---|---|---|
  | transaction / entry | 記録 | 내역 | 记录 | 記錄 |
  | account | 口座 | 계좌 | 账户 | 帳戶 |
  | household | 家族 | 가족 | 家庭 | 家庭 |
  | device | デバイス | 기기 | 设备 | 裝置 |
  | sign in / out | ログイン / ログアウト | 로그인 / 로그아웃 | 登录 / 退出登录 | 登入 / 登出 |
  | Inbox | 未分類 | 미분류 | 待分类 | 待分類 |
  | Settings | 設定 | 설정 | 设置 | 設定 |

- **Starter categories and account kinds** in all four (食料品 / 장보기 /
  买菜 / 買菜…). These also become extra names the parser can match through
  `starterLabels.ts`, but they won't match inside unspaced text until step 2.
- **Home taglines**: native pools in `wordmarkPhrases.ts`
  (ちりも積もれば山となる, 티끌 모아 태산, 亲兄弟，明算账…). The lookup now
  tries the full tag before the base language, so `zh-Hant` gets its own
  pool.
- **Voice**: the chip reads JA, KO, 简, 繁; recognizers get `ja-JP`,
  `ko-KR`, `zh-CN`, `zh-TW`.
- **Sign-in email** (`api/src/auth/emailTemplates.ts`) in all four, with
  the same script rule as D289.
- **iPhone permission prompts**: `InfoPlist.strings` in `ja.lproj`,
  `ko.lproj`, `zh-Hans.lproj` and `zh-Hant.lproj`, registered in the Xcode
  project's variant group and `knownRegions`. Checked by parsing the
  project with the `xcode` npm package.

## Checks

- 216 app tests, including the four new files in key parity and
  plural-form completeness, detection (zh-CN/SG/HK/TW, zh-Hans-HK),
  script-aware formatting, and Mandarin-only speech tags.
- Headless Chromium for ja-JP, ko-KR, zh-CN and zh-TW across 12 screens:
  no raw keys, no page errors, the right language picked from the device
  locale, starter categories in each language. Screenshots looked at for
  Settings (11 language chips wrap fine at 390px) and the schedule editor
  (毎月22日 / 每月22日).
- The email's language choice was checked for 11 tags with tsx.

## Step 2: Japanese parser (2026-10-22, `feat/parser-japanese`)

- **Japanese pack** in `parserVocab.ts`:
  - dates and times: 今日/きょう/本日, 昨日/きのう, 一昨日/おととい; weekdays
    (水曜日 = the most recent one) and 先週の月曜 (the previous calendar
    week's, weeks starting Monday); 8月16日 / 2026年8月16日; 15時10分 /
    午後3時半, with 時間 (a duration) excluded;
  - money: income words (給料, 給与, 入金, ボーナス…); currency words
    円 → JPY, 米ドル → USD, カナダドル → CAD, ユーロ, レアル, and plain ドル =
    "some dollar" (docs/73 D272);
  - about 70 category keywords (スーパー, ランチ, コーヒー, タクシー, 家賃,
    電気代…).
- **Shared groundwork, ready for step 3:**
  - New optional pack fields: `noSpaces`, `previousWeekWeekday`,
    `numerals`, `amountCounters`, `merchantAfter`, `edgeParticles`.
  - `findWord()` does a plain substring search for any phrase in a CJK
    script.
  - `extractCjkAmount()` reads 万/千/百/十 forms (3万円, 1万5千円, 千五百円,
    1.5万円). It runs before the digit reader, but only takes a run that
    is followed by a counter (円) or that mixes digits with a unit, so
    一緒/十分 are left alone.
  - Full-width ASCII and the ideographic space are normalized one
    character for one, so spans still line up.
  - The new-merchant guess also reads a katakana/Latin name before で
    (ドトールで). The note keeps that lead-in, like "at Costco".
  - Leftover particles (で, に, を…) are trimmed from the note's edges.
- **Category matching:** a keyword whose every hit sits inside a longer
  keyword of another category is dropped, so アイスコーヒー is Coffee and
  アイス alone is Snacks. This applies to every language.
- **Two fixes for every language**, found by the Japanese tests:
  - "1,500" was read as 1.50. Groups of exactly three digits after a
    separator are now thousands, and a final 1-2 digits are cents
    ("1.500,50", "1,500.50").
  - Since the "99" claimed-text fix, an income word that is also the
    Salary keyword ("salary", 給料) lost its category, because direction
    claimed it first. Category is now matched before direction.
- **Checks:** 227 app tests, including 10 Japanese cases and the
  thousands cases. In headless Chromium with a ja-JP device, through
  the real entry box: 昨日ドトールでアイスコーヒー650円 → ￥650, Coffee,
  yesterday, merchant ドトール (guessed); 家賃3万円 → ￥30,000, Rent;
  先週の月曜 映画 1800円 → ￥1,800, Movies, the previous week's Monday.

## Known gaps

- **Korean and Chinese aren't understood by the parser yet** (step 3).
  Amounts written as digits are found, and Chinese 万/千 amounts already
  read through the shared numerals once its pack lists them. "¥" still
  always means yen, which is wrong for Chinese until step 3.
- **A fresh install defaults to CAD** whatever the device region
  (`defaultCurrencyFor()`'s fallback). Japanese, Korean and Chinese users
  would want ￥/₩/¥ from the start. Raised with the user, not changed.
- Store listings and the website stay in the docs/73 languages for now.
