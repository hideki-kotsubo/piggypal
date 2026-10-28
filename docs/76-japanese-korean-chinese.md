# 76 — Japanese, Korean and Chinese (step 1: the app's text)

2026-10-22. Asked for by the user after docs/73's four languages were live.
Step 1, built the same day on branch `feat/i18n-cjk`, covers everything except
the parser. Steps 2 and 3 (the Japanese, Korean and Chinese parsers) were
built the same day too, each described below.

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
before they're announced (2026-10-22). Dropped 2026-10-27: the user's
tests with real users found no misparses, so the website and posts now
announce all seven languages (docs/74, "First two weeks").

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
| D293 | In Chinese, "¥" is yuan, and a bare 元/块 after a number is the script's local yuan: CNY for Simplified, TWD for Traditional. Named currencies (美元, 日元, 港元…) are matched first. | "¥" is the yuan's own sign in China. Traditional readers are mostly in Taiwan, where 元 is the NT dollar; Hong Kong's 元 (HKD) is the known exception, covered by writing 港币/HK$. |

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

## Step 3, part 1: Korean parser (2026-10-22, `feat/parser-korean`)

- **Korean pack**:
  - dates and times: 오늘, 어제, 그저께/그제; weekdays (수요일) and 지난주
    월요일; 10월 3일 / 2025년 3월 15일 (the CJK date shape now takes 월/일/년
    and spaces); 오후 3시 30분 / 3시 반, with 3시간 (a duration) excluded;
  - money: income words (월급, 급여, 입금, 보너스…); currency words
    ₩ / 원 → KRW, 엔 → JPY, 미국 달러 → USD, 캐나다 달러 → CAD, 유로,
    헤알, and plain 달러 = "some dollar";
  - about 50 category keywords (마트, 점심, 커피, 택시, 월세, 통신비…).
- **Particles**: Korean spaces words but glues particles onto them
  (커피를, 마트에서). Substring matching handles those inside the text. The
  note trims only particles that rarely end a noun (에서, 으로, 을/를, 은/는,
  에…), never 이/가, which would clip 고양이.
- **Amounts**: Hangul units 만/천/백/십 and Sino-Korean digits join the
  shared reader. A space right after a unit stays inside the amount
  ("5만 2천 원"), and the counter may follow a space ("5만 원").
- **Two traps, closed for every CJK language:**
  - A run made only of native digits never counts as an amount; it needs
    a unit or an Arabic digit. 사원 ("employee") and 오늘 start with
    numeral syllables.
  - 원 counts as won only right after a number, because it also ends
    ordinary words (병원 "hospital", 회원 "member").
- **Merchant guess**: a Hangul or Latin name before 에서 (투썸플레이스에서).
  Each pack now names its own merchant-name characters
  (`merchantNameChars`).
- **Checks**: 236 app tests, including 9 Korean cases that cover each
  trap. In headless Chromium with a ko-KR device, through the real entry
  box: 어제 투썸플레이스에서 라떼 5000원 → ₩5,000, Coffee, yesterday,
  merchant 투썸플레이스 (guessed); 월세 50만 원 → ₩500,000, Rent; 지난주
  월요일 영화 12000원 → ₩12,000, Movies, the previous week's Monday.

## Step 3, part 2: Chinese parser (2026-10-22, `feat/parser-chinese`)

- **Chinese pack**, every word in both scripts:
  - dates and times: 今天, 昨天, 前天; weekdays (星期三/周三/礼拜三) and
    上周一 / 上個星期一; 10月3号 (号/號 join 日 as the day suffix);
    下午3点半, 晚上8点20分 (上午/下午/早上/晚上/中午);
  - money: income words (工资, 薪水, 奖金, 到账…); about 110 category
    keywords (超市, 午饭, 咖啡, 打车, 房租, 话费…).
- **Currency** (D293):
  - "¥" and "￥" mean yuan when Chinese is the input language's pack,
    and yen otherwise.
  - A bare 元/块/圆 right after a number is the local yuan for the
    script: CNY in Simplified, TWD in Traditional. Hong Kong also reads
    Traditional, but there 元 means HKD; it gets TWD for now, and 港币 /
    港元 / HK$ are always HKD.
  - Named currencies win first, because several contain 元: 美元, 日元,
    加元, 欧元, 港元, 新台币, 韩元, 人民币.
- **Amounts**:
  - 块/毛 forms: 3块5 and 3块5毛 = 3.50, 5毛 = 0.50, 两块钱 = 2.00
    (两 is 2). A native digit after the counter is tenths only when it
    ends there or takes 毛, so 30元零食 and 30元一杯 keep their words.
  - The spoken shortening: 一百五 = 150, 一万五 = 15,000 (one digit
    after a unit of 100 or more stands for the next unit down);
    十五 stays 15.
  - 点 between digits before a yuan counter is the decimal point
    (3点5元 = 3.50), and that is never read as 3 o'clock.
  - 一块蛋糕15元: native digits alone with a counter count only when
    钱 follows, so "a piece of cake" isn't ¥1.
- **Merchant guess**: the name between 在 and the verb (在全家买早餐 →
  全家), stopping at 买/吃/喝/花/付/刷… or text another field read
  (在超市买菜 is Groceries, no merchant). 现在/正在/存在 aren't "at".
- **Checks**: 246 app tests, including 10 Chinese cases. In headless
  Chromium through the real entry box, zh-CN: 昨天在全家买咖啡35元 →
  ¥35, Coffee, yesterday, merchant 全家 (guessed); 房租3万元 → ¥30,000,
  Rent; 上周一电影60元 → the previous week's Monday. zh-TW:
  電影300元 → TWD; ¥30 奶茶 → CNY, Snacks. The browser run found that
  两块钱零食 lost Snacks (零 read as tenths); fixed and tested.

## Known gaps

- **TWD shows "$300.00"** in zh-TW: Intl gives TWD two decimals and a
  plain "$". Taiwan writes NT$300. A formatting question, not the
  parser's; in the backlog.
- **Hong Kong 元** reads as TWD (see D293).
- **A fresh install defaults to CAD** whatever the device region
  (`defaultCurrencyFor()`'s fallback). Japanese, Korean and Chinese users
  would want ￥/₩/¥ from the start. Raised with the user, not changed.
- Store listings and the website stay in the docs/73 languages for now.
