import type { Account, Category } from './types';

// docs/16 — Tier 1 (docs/04): a pure, on-device, closed-vocabulary rule
// parser. No React/store imports, no network. Never guesses between two
// plausible options — ambiguous fields come back null so the caller can
// degrade to the uncategorized inbox rather than write a wrong value.
//
// Merchant matching (docs/16 D150) is closed-vocabulary too: it only
// recognizes merchants the user has already used at least once (`ctx.
// merchants`), the same never-invent-an-unseen-value principle as
// category/account matching below — genuinely open-vocabulary merchant
// extraction (spotting a brand-new merchant name never seen before) is
// still Tier 2/AI territory, per docs/15 D77.
//
// Deliberately out of scope: the docs/04 learning loop (this module only
// reads category_keywords, never writes corrections back to it).
//
// Every recognized field also records the text span it matched (see
// `Span` below), so the entry point can compute `unrecognized`: whatever
// of the original utterance wasn't claimed by any structured field
// (docs/16 D150) — e.g. "coffee with Sarah 5" recognizes the amount and
// category, and leaves "with Sarah" as unrecognized leftover for the
// caller to keep as a note instead of silently discarding it.

export interface ParserContext {
  categories: Category[];
  keywords: { categoryId: string; keyword: string }[];
  accounts: Account[];
  merchants: string[];
  now: Date;
}

export interface ParseResult {
  amountCents: number | null; // null = no amount found at all
  direction: 'expense' | 'income';
  currency: string | null; // null = caller applies its own default
  occurredAt: string | null; // null = caller uses now
  categoryId: string | null; // null = ambiguous/no match -> inbox
  accountId: string | null; // null = caller falls back to last-used
  merchant: string | null; // null = no known merchant recognized
  unrecognized: string | null; // null = the whole utterance was recognized
}

// [start, end) character offsets into the original utterance (and,
// equally, into its lowercased form — toLowerCase() doesn't change string
// length for the Latin/Portuguese text this parser targets, so offsets
// computed against either string line up with both).
type Span = [number, number];

const WORD = '[a-zà-ÿ]+';

// ---- amount ----

// Bare integer "45" -> 4500 cents, matching docs/04's tool-schema
// description verbatim ("'45' means 4500. '12,50' means 1250.").
function extractDigitAmount(text: string, spans: Span[]): number | null {
  const match = text.match(/\d+(?:[.,]\d{1,2})?/);
  if (!match || match.index === undefined) return null;
  spans.push([match.index, match.index + match[0].length]);
  const raw = match[0];
  const sepIndex = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
  if (sepIndex === -1) return Number(raw) * 100;
  const intPart = raw.slice(0, sepIndex) || '0';
  const decPart = raw.slice(sepIndex + 1).padEnd(2, '0');
  return Number(intPart) * 100 + Number(decPart);
}

// Small bilingual fallback for when speech-to-text or typed input spells
// numbers out ("quarenta e cinco", "forty five") instead of using digits —
// whole-dollar amounts only, no cents from word form. 1-19 + tens, plus
// simple "<tens> e/and <ones>" compounds.
const NUMBER_WORDS: Record<string, number> = {
  zero: 0,
  one: 1, um: 1, uma: 1,
  two: 2, dois: 2, duas: 2,
  three: 3, três: 3, tres: 3,
  four: 4, quatro: 4,
  five: 5, cinco: 5,
  six: 6, seis: 6,
  seven: 7, sete: 7,
  eight: 8, oito: 8,
  nine: 9, nove: 9,
  ten: 10, dez: 10,
  eleven: 11, onze: 11,
  twelve: 12, doze: 12,
  thirteen: 13, treze: 13,
  fourteen: 14, quatorze: 14, catorze: 14,
  fifteen: 15, quinze: 15,
  sixteen: 16, dezesseis: 16,
  seventeen: 17, dezessete: 17,
  eighteen: 18, dezoito: 18,
  nineteen: 19, dezenove: 19,
  twenty: 20, vinte: 20,
  thirty: 30, trinta: 30,
  forty: 40, quarenta: 40,
  fifty: 50, cinquenta: 50,
  sixty: 60, sessenta: 60,
  seventy: 70, setenta: 70,
  eighty: 80, oitenta: 80,
  ninety: 90, noventa: 90,
};

function extractWordAmount(tokens: RegExpMatchArray[], spans: Span[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i][0];
    const value = NUMBER_WORDS[word];
    if (value === undefined) continue;
    const start = tokens[i].index!;
    if (value >= 20 && value % 10 === 0) {
      let j = i + 1;
      if (tokens[j]?.[0] === 'e' || tokens[j]?.[0] === 'and') j++;
      const nextWord = tokens[j]?.[0];
      const next = nextWord !== undefined ? NUMBER_WORDS[nextWord] : undefined;
      if (next !== undefined && next < 10) {
        spans.push([start, tokens[j].index! + tokens[j][0].length]);
        return value + next;
      }
    }
    spans.push([start, start + word.length]);
    return value;
  }
  return null;
}

// ---- currency (explicit markers only — never inferred from amount size
// or vocabulary, per docs/04) ----

const CURRENCY_MARKERS: [RegExp, string][] = [
  [/r\$/i, 'BRL'], [/\breais?\b/i, 'BRL'], [/\breal\b/i, 'BRL'],
  [/¥/, 'JPY'], [/\bienes?\b/i, 'JPY'], [/\byen(?:es)?\b/i, 'JPY'],
  [/€/, 'EUR'], [/\beuros?\b/i, 'EUR'],
  [/us\$/i, 'USD'], [/\busd\b/i, 'USD'], [/\bdólares?\b/i, 'USD'], [/\bdolares?\b/i, 'USD'],
  [/\bcad\b/i, 'CAD'], [/c\$/i, 'CAD'],
];

function extractCurrency(text: string, spans: Span[]): string | null {
  for (const [re, code] of CURRENCY_MARKERS) {
    const match = re.exec(text);
    if (match) {
      spans.push([match.index, match.index + match[0].length]);
      return code;
    }
  }
  return null;
}

// ---- relative date (closed set only — defaults to `now` in the caller
// when this returns null) ----

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0, domingo: 0,
  monday: 1, segunda: 1,
  tuesday: 2, terça: 2, terca: 2,
  wednesday: 3, quarta: 3,
  thursday: 4, quinta: 4,
  friday: 5, sexta: 5,
  saturday: 6, sábado: 6, sabado: 6,
};

function pad(n: number): string {
  return String(n).padStart(2, '0');
}
function toOccurredAt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
function shiftDays(base: Date, days: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() - days);
  return d;
}
function lastWeekday(now: Date, targetDow: number): Date {
  let daysBack = (now.getDay() - targetDow + 7) % 7;
  if (daysBack === 0) daysBack = 7; // "last <today's own weekday>" means a week ago, not today
  return shiftDays(now, daysBack);
}

function resolveRelativeDate(textLower: string, now: Date, spans: Span[]): string | null {
  const today = new RegExp(`\\b(hoje|today)\\b`).exec(textLower);
  if (today) {
    spans.push([today.index, today.index + today[0].length]);
    return toOccurredAt(now);
  }
  const anteontem = new RegExp(`\\banteontem\\b`).exec(textLower);
  if (anteontem) {
    spans.push([anteontem.index, anteontem.index + anteontem[0].length]);
    return toOccurredAt(shiftDays(now, 2));
  }
  const ontem = new RegExp(`\\b(ontem|yesterday)\\b`).exec(textLower);
  if (ontem) {
    spans.push([ontem.index, ontem.index + ontem[0].length]);
    return toOccurredAt(shiftDays(now, 1));
  }

  const lastEn = textLower.match(new RegExp(`\\blast\\s+(${WORD})\\b`));
  if (lastEn && lastEn[1] in WEEKDAY_INDEX) {
    spans.push([lastEn.index!, lastEn.index! + lastEn[0].length]);
    return toOccurredAt(lastWeekday(now, WEEKDAY_INDEX[lastEn[1]]));
  }

  const passadaPt =
    textLower.match(new RegExp(`\\b(${WORD})\\s+passad[ao]\\b`)) ?? textLower.match(new RegExp(`\\búltim[ao]\\s+(${WORD})\\b`));
  if (passadaPt && passadaPt[1] in WEEKDAY_INDEX) {
    spans.push([passadaPt.index!, passadaPt.index! + passadaPt[0].length]);
    return toOccurredAt(lastWeekday(now, WEEKDAY_INDEX[passadaPt[1]]));
  }

  return null;
}

// ---- category (never-guess: exactly one distinct match, else null) ----

function matchCategory(textLower: string, ctx: ParserContext, spans: Span[]): string | null {
  const vocab = new Map<string, string>();
  for (const k of ctx.keywords) vocab.set(k.keyword.toLowerCase(), k.categoryId);
  for (const c of ctx.categories) {
    const key = c.name.toLowerCase();
    if (!vocab.has(key)) vocab.set(key, c.id);
  }
  const matched = new Set<string>();
  for (const [keyword, categoryId] of vocab) {
    if (textLower.includes(keyword)) matched.add(categoryId);
  }
  if (matched.size !== 1) return null;
  const categoryId = [...matched][0];
  // Every keyword that resolved to the winning category counts as
  // recognized text, not just the first one found — "mercado" and
  // "grocery" both appearing shouldn't leave one of them as leftover.
  for (const [keyword, id] of vocab) {
    if (id !== categoryId) continue;
    const idx = textLower.indexOf(keyword);
    if (idx !== -1) spans.push([idx, idx + keyword.length]);
  }
  return categoryId;
}

// ---- account (exact-name match only, no fuzzy matching, per docs/04) ----

function matchAccount(textLower: string, ctx: ParserContext, spans: Span[]): string | null {
  // An institution+name pair both present is an explicit disambiguation
  // ("no Visa do TD") — trust it even if the bare name alone is shared by
  // another account.
  const disambiguated = ctx.accounts.filter(
    (a) => a.institution && textLower.includes(a.institution.toLowerCase()) && textLower.includes(a.name.toLowerCase()),
  );
  if (disambiguated.length === 1) {
    const account = disambiguated[0];
    const instIdx = textLower.indexOf(account.institution!.toLowerCase());
    if (instIdx !== -1) spans.push([instIdx, instIdx + account.institution!.length]);
    const nameIdx = textLower.indexOf(account.name.toLowerCase());
    if (nameIdx !== -1) spans.push([nameIdx, nameIdx + account.name.length]);
    return account.id;
  }
  if (disambiguated.length > 1) return null;

  // Otherwise, bare name only — ambiguous ("Visa" at two institutions,
  // doc04's own example) unless exactly one account matches.
  const byName = ctx.accounts.filter((a) => textLower.includes(a.name.toLowerCase()));
  const distinctIds = new Set(byName.map((a) => a.id));
  if (distinctIds.size !== 1) return null;
  const nameIdx = textLower.indexOf(byName[0].name.toLowerCase());
  if (nameIdx !== -1) spans.push([nameIdx, nameIdx + byName[0].name.length]);
  return byName[0].id;
}

// ---- merchant (docs/16 D150): closed-vocabulary against merchants the
// user has already used at least once — never invents an unseen name,
// same never-guess principle as category/account above. Genuinely new
// merchants stay unrecognized (surfaced via the Note field instead, see
// `computeUnrecognized`) until Tier 2/AI extraction exists (docs/15 D77).

function matchMerchant(textLower: string, ctx: ParserContext, spans: Span[]): string | null {
  const matched = new Set<string>();
  for (const m of ctx.merchants) {
    if (textLower.includes(m.toLowerCase())) matched.add(m);
  }
  if (matched.size !== 1) return null;
  const merchant = [...matched][0];
  const idx = textLower.indexOf(merchant.toLowerCase());
  if (idx !== -1) spans.push([idx, idx + merchant.length]);
  return merchant;
}

// ---- direction ----

const INCOME_TRIGGERS = [
  'recebi', 'salário', 'salario', 'salary', 'deposit', 'depósito', 'deposito',
  'received', 'got paid', 'paycheck', 'income',
];

function matchDirection(textLower: string, spans: Span[]): 'expense' | 'income' {
  for (const w of INCOME_TRIGGERS) {
    const idx = textLower.indexOf(w);
    if (idx !== -1) {
      spans.push([idx, idx + w.length]);
      return 'income';
    }
  }
  return 'expense';
}

// ---- unrecognized leftover: the original text with every recognized
// span cut out, whitespace collapsed. Spans can arrive unsorted and
// overlapping (e.g. a category keyword and a merchant name sharing a
// word) — sorting and tracking a cursor handles both without double-
// counting or going out of order. Empty/whitespace-only leftover is null,
// same "nothing to say" convention as every other optional field here.

function computeUnrecognized(text: string, spans: Span[]): string | null {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let leftover = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) leftover += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  leftover += text.slice(cursor);
  const cleaned = leftover.replace(/\s+/g, ' ').trim();
  return cleaned || null;
}

// ---- entry point ----

export function parseUtterance(text: string, ctx: ParserContext): ParseResult {
  const textLower = text.toLowerCase();
  const tokens = Array.from(textLower.matchAll(new RegExp(WORD, 'g')));
  const spans: Span[] = [];

  const digitAmount = extractDigitAmount(text, spans);
  const wordAmount = digitAmount === null ? extractWordAmount(tokens, spans) : null;
  const amountCents = digitAmount !== null ? digitAmount : wordAmount !== null ? wordAmount * 100 : null;

  const direction = matchDirection(textLower, spans);
  const currency = extractCurrency(text, spans);
  const occurredAt = resolveRelativeDate(textLower, ctx.now, spans);
  const categoryId = matchCategory(textLower, ctx, spans);
  const accountId = matchAccount(textLower, ctx, spans);
  const merchant = matchMerchant(textLower, ctx, spans);

  return {
    amountCents,
    direction,
    currency,
    occurredAt,
    categoryId,
    accountId,
    merchant,
    unrecognized: computeUnrecognized(text, spans),
  };
}
