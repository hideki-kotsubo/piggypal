# 84 — Capture channels: faster ways to get transactions in

Status: **brainstorm only** (2026-11-12). Nothing decided or built. The
items are tracked in `docs/00-backlog.md` under Later; this doc keeps the
reasoning behind them. No D-numbers yet. Proposals here are labelled C-1…
and get real D-numbers if and when they're picked up.

## The goal

Cut the steps between "I just paid" and "it's recorded". Today the user
types or says the purchase (docs/16), adds it by hand (docs/19), or
imports a file (docs/81, step 1 built). Everything below is a new way in.
Every channel feeds the same Inbox and the same docs/81 matching, so a
purchase caught twice (say, by a tap automation and later a statement)
is matched, not duplicated.

Constraints every channel must respect (CLAUDE.md locked decisions):

- **3, one write path.** Nothing on the server inserts transactions.
  Native code doesn't either: it queues raw text and the app writes the
  record locally.
- **5, free tier never contacts the server.** Anything server-side is
  paid and adds a subscription-gate point, which must be flagged.
- **Positioning: simple, light, private.** Prefer on-device options.

## Summary

| # | Channel | Where it runs | Tier | Countries | Verdict |
|---|---|---|---|---|---|
| C-1 | Native capture layer (Siri, Shortcuts action, widgets, Control Center, Action Button, Android tiles/shortcuts) | device | all | all | do first |
| C-2 | Apple Pay tap automation (Shortcuts Wallet trigger) | device | all | all (iOS) | do with C-1 |
| C-3 | Push notification / SMS capture | device | all | all | later, after C-1 |
| C-4 | Email-forwarding capture | server | paid | all | later, good fit for paid |
| C-5 | Share to Flowtab (Pix receipts, screenshots, PDFs) | device | all | all (BR first) | after receipt OCR |
| C-6 | Fewer fields: repeat/favorites, smart account, travel mode | device | all | all | cheap, soon |
| C-7 | Several purchases in one sentence | device | all | all | cheap, soon |
| C-8 | End-of-day reminder with quick reply | device | all | all | cheap |
| C-9 | Bank CSV / PDF statement import | device (+ paid LLM) | all / paid | all | already planned in docs/81 |
| C-10 | Apple FinanceKit | device | all | mainly US | low value for current users |
| C-11 | Bank-data aggregators (Plaid, Flinks, GoCardless, Belvo, Akahu, Stitch) | server | paid | per provider | possible future |
| C-12 | Watch apps, WhatsApp/Telegram bot | device / server | — | — | later |
| — | Forwarding SMS to the server | — | — | — | rejected |

Suggested order: C-1 + C-2, then C-6 and C-7, then C-5 (with docs/77
Part B's OCR plugin). C-3/C-4 after that.

## C-1. Native capture layer

One native App Intent, "Log expense", that takes text. Through it:

- **Siri / Spotlight / Shortcuts (iOS):** an App Shortcuts provider makes
  the action available as soon as the app is installed, **no setup**.
  Free-form text can't be in the Siri phrase itself, so it's two steps:
  "Log an expense in Flowtab" → Siri asks "What did you spend?" →
  "12 dollars lunch".
- **Widget extension (iOS):** Home/Lock Screen widget, iOS 18 Control
  Center control, Action Button. Each just deep-links into voice entry
  and shows no data, so no shared database is needed. **Manual setup**:
  iOS doesn't let apps add these; the app can only show a hint.
- **Android:** static/dynamic app shortcuts (long-press icon, **no
  setup**); Quick Settings tile and home widget, each added through a
  **one-tap system prompt** (`requestAddTileService`,
  `requestPinAppWidget`).

**How it works.** Siri, automations and widgets run native Swift code
while the app's JavaScript (and so `parser.ts`) isn't running. The intent
only saves the raw text (plus any structured fields, see C-2) to a small
native queue in an App Group file, and can show a "Saved" confirmation.
On next open the app reads the queue, parses each item and writes it to
the Inbox through the normal local write path. That keeps locked
decision 3 intact.

Cost: a custom Capacitor plugin plus a widget extension target in Xcode
(and the Android equivalents). Done once; C-2, C-3 and the Siri/widget
entry points all reuse it.

## C-2. Apple Pay tap automation

Since iOS 17, Shortcuts has a **Wallet "Transaction" automation**: when
the user pays with one of the chosen cards via Apple Pay, it fires and
passes the **merchant, amount and card name**.

- Works with **any card in Apple Pay**, any country (CA/BR included); no
  entitlement, no server. The best on-device option for the current
  users.
- Only in-person Apple Pay taps. Online purchases and physical-card
  payments don't trigger it.
- Card name can map to a Flowtab account.

**Setup is always manual, once.** iOS doesn't let apps create
automations. The user does it in Shortcuts, about 6 taps: Automation →
+ → Wallet → pick cards → Run Immediately → add Flowtab's "Log expense"
action. After that it runs on every tap with no confirmation.

Making setup easier:

- An in-app guide with screenshots or a short video, shown at a good
  moment (e.g. after a few card purchases logged by hand).
- Flowtab's action fills merchant/amount/card by itself, so the user
  never wires up variables.

Needs C-1.

## C-3. Push notification / SMS capture

Capture a purchase from the bank's own notification or SMS.

- **iOS:** no app can read other apps' notifications or SMS. The only
  route is a Shortcuts automation (e.g. "Message received" trigger, or
  the user sharing the text) that sends the text to Flowtab's C-1
  action.
- **Android:** a `NotificationListenerService` (user grants notification
  access) and/or SMS reading, via a custom Capacitor plugin. Google Play
  restricts SMS permissions heavily, so notifications are the safer path.

The text goes through the existing docs/16 parser and lands in the
Inbox. Open: per-bank message formats (BR/CA/JP), privacy wording,
battery/background limits. In Brazil banks mostly use push notifications,
not SMS.

**Rejected: forwarding SMS to the server.** Every forwarding route (iOS
Shortcut POST, Android forwarder app, a Twilio number, which carriers
rarely auto-forward to and which costs per message) already runs on the
phone. Parsing there is simpler, works offline, suits the free tier and
keeps the text private. Sending it to the server adds risk and cost
without reaching anyone new.

## C-4. Email-forwarding capture (paid)

Each account gets a private inbound address, a long random token such as
`<token>@in.myflowtab.com`, which can be regenerated. The user points
the bank's alert emails at it, or sets a Gmail/Outlook auto-forward rule.

Why it's a good fit: works on every platform; Canadian and Brazilian
banks and card issuers almost all send purchase alerts by email; their
format is fixed, so they're much easier to parse than PDF statements.

Locked decisions:

1. **Decision 3:** the server parses each email into a **pending
   capture** row (a new synced table). The device turns captures into
   Inbox items through its own local write path, the same rule the LLM
   follows.
2. **Decision 5:** needs an account and sync, so it's paid, perhaps a
   selling point for Flowtab Sync. The inbound endpoint is another
   subscription-gate point, to be flagged (same as docs/77 Part B
   phase 2).
3. **Privacy:** keep only the extracted fields, delete the raw email
   within minutes, update the privacy policy and the App Store / Play
   data-safety answers.

Risks and design points:

- **Spoofing:** anyone who learns the address could inject fake
  purchases. Token address, optional allowed bank senders checked with
  DKIM, and captures always go to Inbox review, never posted
  automatically.
- **Forwarding confirmation:** Gmail/Outlook send a confirmation email to
  the new address before they forward anything. Flowtab must catch it and
  show the code/link, or setup stalls.
- **Account mapping:** alerts usually show only the card's last 4
  digits, so accounts need a last-4 field.
- **Parsing:** per-bank templates first, Tier 2 LLM fallback for unknown
  formats.
- **Dedupe** against hand-entered records and statement imports reuses
  docs/81 matching.
- **Infra:** an inbound mail provider with a webhook (Postmark, Mailgun,
  SendGrid Inbound Parse) or our own MX. Check whether SMTP2GO (docs/44)
  has inbound.

## C-5. Share to Flowtab

A share target/extension accepting text, screenshots, PDFs and images.

- **Brazilian Pix receipts (comprovantes)** are shared constantly and
  have a fixed layout, easy to parse.
- Also order confirmations (Uber, iFood…) and copied bank text.
- Images reuse docs/77 Part B's on-device OCR plugin.

## C-6. Fewer fields to fill

- Repeat last / favorites / recent merchants as one-tap chips;
  time-of-day suggestions (morning coffee).
- Smart default account per merchant/category.
- Travel mode: when the device's country changes, suggest switching the
  default currency and card (fits the user's own multi-currency travel,
  docs/10).
- Pairs with the deferred docs/04 learning loop: corrections teach the
  parser, so fewer records land in the Inbox from every channel.

## C-7. Several purchases in one sentence

"coffee 5 and lunch 18 and uber 22" → three records. Parser change only.
Pairs with the parked desktop multi-line paste (docs/80).

## C-8. End-of-day reminder

Opt-in local notification ("Anything to log today?") with an inline
quick reply, parsed on the device. Skipped on days with entries. No
server.

## C-9. Bank CSV / PDF statement import

Already planned in docs/81. Added to the statement-import item in the
backlog (after its step 3): CSV with per-bank column mapping/presets,
PDF via docs/81's options (on-device text layer first, statement-totals
gate). The older notes are in the backlog's "Import records from
CSV/XLSX" item.

## C-10. Apple FinanceKit

Read-only, on-device access to Wallet transactions and balances after
the user approves; newer iOS can deliver new transactions in the
background. Technically a great fit (no server, no per-connection fee),
via a small Swift Capacitor plugin feeding docs/81's import flow.

Why it's low value for now:

- Coverage is mainly **US Apple Card** (plus probably Apple Cash and
  Savings; UK cards connected to Wallet through open banking are
  unconfirmed). Nothing found for Canada, Brazil or Japan. Ordinary
  Visa/Mastercard cards in Apple Pay don't expose history through it.
- A **managed entitlement**: request form, reviewed by Apple; requires an
  **organization** developer account with an Account Holder (an
  individual enrollment would have to convert, which needs a D-U-N-S
  number). Developers have reported slow/unclear approvals.
- iPhone/iPad only; no Android equivalent.

Check Apple's current country list before picking it up. C-2 covers more
of the current users sooner.

Sources: [Get started with FinanceKit](https://developer.apple.com/financekit),
[FinanceKit documentation](https://developer.apple.com/documentation/financekit),
[developer forum thread](https://developer.apple.com/forums/thread/746770).

## C-11. Bank-data aggregators

Plaid / Flinks (US/CA), GoCardless Bank Account Data (EU/UK), Belvo
(LatAm/BR), Akahu (NZ), Stitch (ZA). All need a server (the app is
local-first), per-connection fees that point to a paid tier, provider
approval/compliance reviews, and secure storage of bank tokens. Imported
rows would reuse the docs/81 import/reconciliation flow, not a separate
path. Possible future only.

## C-12. Later

- Apple Watch / Wear OS voice entry: good, but a separate native app.
- WhatsApp/Telegram bot: popular in Brazil, but server-side, privacy
  cost, and WhatsApp's business API is paid. Would reuse C-4's pending
  capture pattern.
