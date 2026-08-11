# AI Entry Pipeline — "45 mercado ontem" → transaction row

## Two-tier design (offline-first, honest about it)

```
User input (text or voice→text)
        │
        ▼
┌─ Tier 1: rule-based parser (on-device, free tier) ─┐
│  Regex + vocab tables: numbers, number-words,      │
│  relative dates, category keywords (pt-BR + en),   │
│  exact-name match against account list (no fuzzy   │
│  matching — falls back to last-used account)       │
└────────────────┬───────────────────────────────────┘
                 │ confident? ──yes──► local SQLite insert (source='ai')
                 │ no / online / paid
                 ▼
┌─ Tier 2: LLM tool-use (your Node API → Claude) ────┐
│  Structured extraction with the user's own         │
│  categories injected as enum                       │
└────────────────┬───────────────────────────────────┘
                 │ confident? ──yes──► insert
                 │ no
                 ▼
        Uncategorized inbox (category_id = null)
        User taps a category chip → done
        That correction becomes training signal for Tier 1 vocab
```

Key property: the app **never blocks on parsing**. Worst case, the transaction lands in the inbox with amount + date and the user assigns a category in one tap. Ambiguity degrades to friction, never to data loss.

## Tier 2: the tool definition

One tool, forced via `tool_choice`, so output is always valid JSON:

```typescript
const recordTransaction = {
  name: "record_transaction",
  description: "Extract a financial transaction from a natural language utterance.",
  input_schema: {
    type: "object",
    properties: {
      amount_cents: {
        type: "integer",
        description: "Absolute amount in cents. '45' means 4500. '12,50' means 1250."
      },
      direction: { type: "string", enum: ["expense", "income"] },
      currency: {
        type: "string",
        description: "ISO 4217 code. Infer only from explicit currency words/symbols (reais/R$ → BRL, ienes/¥ → JPY, euros/€ → EUR). If none mentioned, use the default currency given in the prompt (accounts don't have a currency of their own, see docs/10 D62) — never guess a foreign currency from amount size or vocabulary alone."
      },
      occurred_on: {
        type: "string",
        description: "ISO date. Resolve relative terms (ontem, anteontem, last friday) against `today` given in the prompt."
      },
      category_id: {
        type: ["string", "null"],
        description: "Must be one of the provided category ids, or null if none clearly fits. Never guess between two plausible options — return null."
      },
      account_id: {
        type: ["string", "null"],
        description: "Must be one of the provided account ids, only when the utterance explicitly names or clearly implies one ('no cartão Visa', 'with my Wise card'). Null otherwise — the client falls back to the last-used account. Never guess between two plausible accounts."
      },
      note: { type: "string", description: "Short merchant/description, cleaned. 'mercado' → 'Mercado'" },
      confidence: { type: "string", enum: ["high", "low"] }
    },
    required: ["amount_cents", "direction", "currency", "occurred_on", "category_id", "account_id", "note", "confidence"]
  }
};
```

## The prompt (system side)

```
You extract transactions from short utterances in Portuguese or English.
Today is {today} ({timezone}). This entry defaults to account "{account_name}",
currency {default_currency} (that account's own last-used currency, or the
most recent transaction's currency if it has no history — accounts don't
carry a currency of their own, see docs/10 D62) — use that unless the
utterance names another account and/or currency.

User's categories (choose category_id from these ONLY):
{id: "…", name: "Mercado", keywords: ["mercado","grocery","superstore","costco"]}
{id: "…", name: "Transporte", keywords: ["uber","gas","gasolina","translink"]}
...

User's accounts (choose account_id from these ONLY, or null):
{id: "…", institution: "TD", name: "Visa", kind: "credit"}
{id: "…", institution: "Itaú", name: "Visa", kind: "credit"}
{id: "…", institution: "Wise", name: "BRL", kind: "checking"}
{id: "…", institution: null, name: "Cash", kind: "cash"}
...

Rules:
- Expenses are the default; only mark income on clear signals (recebi, salário, got paid).
- If the amount is ambiguous or missing, set confidence: low.
- If two categories are equally plausible, category_id: null, confidence: low.
- account_id: only set when explicitly named or clearly implied. Never infer
  an account from amount, category, or currency alone — those don't reliably
  imply which card or account was used. With multiple same-network cards
  across institutions ("Visa" at both TD and Itaú), a bare "no cartão Visa"
  is genuinely ambiguous — treat it as null unless the institution is also
  named ("no Visa do TD"), same never-guess rule as category_id.
- Currency: only override the default when the utterance explicitly names or
  symbolizes another currency (see docs/10). Never infer a foreign currency
  from amount size or merchant vocabulary alone.
```

Injecting the **user's own categories with their learned keywords** is what makes this good. The keywords list grows from inbox corrections (see below).

## API endpoint

```
POST /api/parse   { utterance: string }        [paid tier only]
```

1. Auth → user_id, check subscription.
2. Load user's active categories (+ keyword vocab).
3. Call Claude (Haiku-class model — this task doesn't need more) with `tool_choice: {type:"tool", name:"record_transaction"}`.
4. Return the structured input block to the client.
5. **Client inserts locally** — the parse result flows through the same local-write → sync path as manual entry. The API never writes the transaction itself. One write path, always.

## The learning loop (no ML required)

When a user corrects an inbox item ("mercado" utterance → they tap *Mercado*):

```sql
insert into category_keywords (user_id, category_id, keyword, hits)
values ($1, $2, lower($3), 1)
on conflict (user_id, category_id, keyword) do update set hits = hits + 1;
```

- Tier 1 parser syncs this table down (add it to the sync bucket) → offline parser gets smarter per user.
- Tier 2 prompt injects it → LLM gets smarter per user.
- Zero training infrastructure. It's just a table.

## Dedupe guard

Voice input + retry buttons = accidental doubles. In the client, before insert:
same amount_cents + same occurred_on + created within 2 minutes → show
"Looks like a duplicate of X — add anyway?" Never silently drop.

## Cost sanity check

Haiku-class call, ~400 input tokens (categories included) + ~100 output.
Even a heavy user (10 entries/day) costs well under $0.10/month — fits
comfortably inside any realistic paid tier price.

## Failure modes

| Situation | Behavior |
|---|---|
| Offline, Tier 1 fails | Inbox with amount+date if parseable, else save raw utterance as draft |
| API down/timeout (>3s) | Fall back to Tier 1 result or inbox; queue nothing |
| LLM returns invalid category_id | Treat as null → inbox (validate server-side) |
| Free user | Tier 1 only; "AI entry" shown as locked feature |
