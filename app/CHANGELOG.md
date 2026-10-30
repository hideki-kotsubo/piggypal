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

## Unreleased

Flowtab now has a proper layout for computers and other wide windows.

- **A menu on the left** takes you straight to Home, Transactions, Inbox,
  Insights, Accounts, Categories, Scheduled and Settings.
- **List and details side by side.** Pick a transaction, account,
  scheduled payment, category or setting and it opens next to the list,
  so you can go through them one after another.
- **Add from anywhere.** The "type or say what you spent" box sits at
  the top of every screen.
- **Home shows more at once:** your recent spending next to the
  last 30 days and this month's budgets.
- On phones the app looks and works as before, and the iPhone and
  Android apps now stay upright when you turn the phone.
- A transaction's location now shows as one selected chip; the other
  suggestions appear when the field is empty or while you type.

## 0.14.1 — 2026-10-28

- **Split purchases show up under each account.** Filtering your
  transactions by account, or tapping "see all" on an account's page, now
  includes purchases split across several accounts, counting only that
  account's share, so the total matches the account's balance.

## 0.14.0 — 2026-10-28

- **A tidier Settings.** Settings is now a short page of groups (your
  money, sync and household, preferences, app), each opening its own page,
  with your sync status at the top.
- **A page for each account.** Tap an account to see its balance, money in
  and out this month, scheduled payments coming up, and its latest
  entries. Edit it from there.
- **Accounts are easier to find.** Accounts are grouped in a card per
  bank, with search once you have a lot of them, totals for each currency,
  and filters per person in a household.
- **Categories at a glance.** Switch between Expense and Income, see what
  each category spent this month, and how far along its budget is.
  Subcategories hang clearly under their group.
- **Editing slides up from the bottom.** Accounts and categories now open
  in a panel instead of inside the list, so it's always clear what you're
  editing.
- **Bring back archived categories and accounts.** Archived ones now have
  a Restore button.

## 0.13.0 — 2026-10-27

- **"Only me" entries.** In a household, tick **Only me** on an entry you
  logged and it syncs only to your own devices. Nobody else in the
  household sees it, and you can switch it back to shared any time.
- **A PIN for each person in the household.** Set it in Settings →
  Household. A new device can only sign in as you, and get your Only me
  entries, once your PIN is entered on it.
- **Forgot your PIN?** Change it on another device that's already you, or
  ask someone in the household to reset it from theirs. Nothing is lost,
  and you'll see who reset it and on which device. The account owner can
  also get a reset code by email.

## 0.12.0 — 2026-10-22

- **Chinese entries are understood**, in Simplified and Traditional:
  "昨天在全家买咖啡35元", "房租3万元", "3块5" or "上周一电影60元" fill in
  the amount, the category, the date and the shop. 元 means yuan in
  Simplified and New Taiwan dollars in Traditional, and "¥" means yuan
  when you write in Chinese.

## 0.11.0 — 2026-10-22

- **Korean entries are understood**: "어제 커피 4500원", "월세 50만 원" or
  "지난주 월요일 영화 12000원" fill in the amount in won, the category, the
  date and the shop.

## 0.10.1 — 2026-10-22

- In browsers without voice input (like Firefox), the mic button now
  shows, dimmed, and tells you which browsers support it.

## 0.10.0 — 2026-10-22

- **Japanese entries are understood**: "昨日ドトールでコーヒー500円",
  "家賃3万円" or "先週の月曜 映画 1800円" fill in the amount in yen, the
  category, the date and the shop.
- Fixed: amounts with a thousands separator ("1,500") were read as 1.50.
- Fixed: "salary 3000" lost its Salary category.

## 0.9.0 — 2026-10-22

- **日本語, 한국어, 中文（简体） and 中文（繁體）**: Flowtab's screens,
  starter categories, voice entry, the sign-in email and the iPhone
  permission prompts are now in Japanese, Korean and Chinese. Typing or
  saying an entry in these languages understands amounts written as
  digits; dates, categories and currency words are coming next.

## 0.8.1 — 2026-10-22

- Fixed: the amount keypad treated **yen and won** as if they had
  cents, so typing 1 5 0 0 gave ￥15. It now types whole yen and won,
  and installment plans in those currencies split into whole amounts.

## 0.8.0 — 2026-10-21

- **Signing out now erases Flowtab's data from this device.** Everything
  that synced stays in your account and comes back when you sign in
  again. To sign out but keep the data here, choose **Disconnect and
  keep data**.
- Before erasing, Flowtab tells you if some changes haven't synced yet.
- Signing in to a different account on a device that still holds
  another account's data now erases that data first, instead of mixing
  the two accounts.

## 0.7.1 — 2026-10-19

- Fixed: prices ending in 99, like "netflix 16.99" or "café 9,99",
  went to your inbox as uncategorized instead of their category.

## 0.7.0 — 2026-10-16

- **"Dollars" means dollars.** Saying "15 dollars" or typing "$15" no
  longer falls back to your account's currency (like reais). Flowtab
  picks a dollar: your account's own, the last one you used, or the new
  **Dollars ($) mean** setting (Canadian or US). Say "canadian dollars"
  or "US dollars" to be exact.
- **Change the currency and account before saving**: tap them in the
  "Understood" panel.
- **Voice language from Home**: tap the small language chip next to the
  mic (EN, PT, FR…). Switch even while it's listening.
- **CA$ and US$**: once you use more than one dollar currency, amounts
  say which dollar they are instead of a plain "$".
- Ice cream, sorvete, helado and glace now go to **Snacks**.
- Fixed: an account with an empty name was picked for every typed or
  spoken entry.

## 0.6.1 — 2026-10-16

- **Voice entry on iPhone no longer freezes** after an attempt that
  didn't catch anything; the next tap starts fresh. If nothing is
  heard, the app now says so instead of staying silent.
- Saying an amount in **dollars** in Portuguese ("cem dólares em
  combustível") now saves it in US dollars instead of the account's
  currency.

## 0.6.0 — 2026-10-17

Flowtab now speaks your language.

- **Português (Brasil), Español and Français**, alongside English. The
  app follows your device's language, or pick one in Settings →
  Language. Spain and Latin America, and France and Canada, each get
  their own wording where it differs.
- **Your starter categories and accounts follow the language too**:
  Groceries becomes Mercado, Supermercado or Épicerie. Devices on the
  same account can each use a different language. Categories you've
  renamed or created stay exactly as you wrote them.
- Dates and amounts are written the way your region writes them.
- **Voice language** in Settings: speak in a different language from
  the app's, for example the app in English while you say
  "quarenta e cinco no mercado".
- Typing or saying what you spent now understands **Spanish and French**
  too, alongside English and Portuguese ("treinta y cinco en el súper",
  "trente-cinq euros de courses hier").
- **Voice entry on Android** now uses the phone's own speech
  recognition.
- The sign-in email and the iPhone permission prompts are in your
  language.

## 0.5.0 — 2026-10-16

- **Delete account** in Settings: the person who created the account
  can delete it, with all its synced data, from inside the app. Your
  budget stays on your device and keeps working without an account.
  Other devices in the household are signed out and told why, and
  keep what's on them.

## 0.4.0 — 2026-10-15

- **Household** in Settings: everyone in your household and the
  devices they use, in one place. Rename people, add someone who
  doesn't have the app yet, or remove someone. Their past
  transactions keep their name, and you can bring them back.
- **Remove a device** you no longer use. It's signed out and has to
  sign in again before it can sync.
- **Add a device with a QR code**: on a device that's already signed
  in, go to Household → Add a device, then scan the code from the new
  device (Settings → Scan a code from a signed-in device). No email
  needed.

## 0.3.8 — 2026-10-13

- **Fixed**: adding Flowtab to your home screen now names it "Flowtab"
  instead of "App".

## 0.3.6 — 2026-10-13

- **Sync now** in Settings: if you're signed in, you can make Flowtab sync
  right away, even when it already says Connected. It shows the progress
  and tells you if it couldn't finish.
- Settings now shows when your data last synced, how many changes are
  still waiting to upload, and when you're offline.

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
