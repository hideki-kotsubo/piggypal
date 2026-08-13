import type { Account, Category } from './types';

// docs/16 — Tier 1 (docs/04): a pure, on-device, closed-vocabulary rule
// parser. No React/store imports, no network. Never guesses between two
// plausible options — ambiguous fields come back null so the caller can
// degrade to the uncategorized inbox rather than write a wrong value.
//
// Deliberately out of scope: merchant/location extraction (open-vocabulary
// proper nouns are a much fuzzier problem than the closed vocab below —
// same reasoning docs/15 D77 already used to keep merchant Tier-2-only; a
// real possible future extension, not attempted here) and the docs/04
// learning loop (this module only reads category_keywords, never writes
// corrections back to it).

export interface ParserContext {
  categories: Category[];
  keywords: { categoryId: string; keyword: string }[];
  accounts: Account[];
  now: Date;
}

export interface ParseResult {
  amountCents: number | null; // null = no amount found at all
  direction: 'expense' | 'income';
  currency: string | null; // null = caller applies its own default
  occurredAt: string | null; // null = caller uses now
  categoryId: string | null; // null = ambiguous/no match -> inbox
  accountId: string | null; // null = caller falls back to last-used
}

const WORD = '[a-zà-ÿ]+';

// ---- amount ----

// Bare integer "45" -> 4500 cents, matching docs/04's tool-schema
// description verbatim ("'45' means 4500. '12,50' means 1250.").
function extractDigitAmount(text: string): number | null {
  const match = text.match(/\d+(?:[.,]\d{1,2})?/);
  if (!match) return null;
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

function extractWordAmount(tokens: string[]): number | null {
  for (let i = 0; i < tokens.length; i++) {
    const value = NUMBER_WORDS[tokens[i]];
    if (value === undefined) continue;
    if (value >= 20 && value % 10 === 0) {
      let j = i + 1;
      if (tokens[j] === 'e' || tokens[j] === 'and') j++;
      const next = NUMBER_WORDS[tokens[j]];
      if (next !== undefined && next < 10) return value + next;
    }
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

function extractCurrency(text: string): string | null {
  for (const [re, code] of CURRENCY_MARKERS) {
    if (re.test(text)) return code;
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

function resolveRelativeDate(textLower: string, now: Date): string | null {
  if (new RegExp(`\\b(hoje|today)\\b`).test(textLower)) return toOccurredAt(now);
  if (new RegExp(`\\banteontem\\b`).test(textLower)) return toOccurredAt(shiftDays(now, 2));
  if (new RegExp(`\\b(ontem|yesterday)\\b`).test(textLower)) return toOccurredAt(shiftDays(now, 1));

  const lastEn = textLower.match(new RegExp(`\\blast\\s+(${WORD})\\b`));
  if (lastEn && lastEn[1] in WEEKDAY_INDEX) return toOccurredAt(lastWeekday(now, WEEKDAY_INDEX[lastEn[1]]));

  const passadaPt =
    textLower.match(new RegExp(`\\b(${WORD})\\s+passad[ao]\\b`)) ?? textLower.match(new RegExp(`\\búltim[ao]\\s+(${WORD})\\b`));
  if (passadaPt && passadaPt[1] in WEEKDAY_INDEX) return toOccurredAt(lastWeekday(now, WEEKDAY_INDEX[passadaPt[1]]));

  return null;
}

// ---- category (never-guess: exactly one distinct match, else null) ----

function matchCategory(textLower: string, ctx: ParserContext): string | null {
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
  return matched.size === 1 ? [...matched][0] : null;
}

// ---- account (exact-name match only, no fuzzy matching, per docs/04) ----

function matchAccount(textLower: string, ctx: ParserContext): string | null {
  // An institution+name pair both present is an explicit disambiguation
  // ("no Visa do TD") — trust it even if the bare name alone is shared by
  // another account.
  const disambiguated = ctx.accounts.filter(
    (a) => a.institution && textLower.includes(a.institution.toLowerCase()) && textLower.includes(a.name.toLowerCase()),
  );
  if (disambiguated.length === 1) return disambiguated[0].id;
  if (disambiguated.length > 1) return null;

  // Otherwise, bare name only — ambiguous ("Visa" at two institutions,
  // doc04's own example) unless exactly one account matches.
  const byName = ctx.accounts.filter((a) => textLower.includes(a.name.toLowerCase()));
  const distinctIds = new Set(byName.map((a) => a.id));
  return distinctIds.size === 1 ? byName[0].id : null;
}

// ---- direction ----

const INCOME_TRIGGERS = [
  'recebi', 'salário', 'salario', 'salary', 'deposit', 'depósito', 'deposito',
  'received', 'got paid', 'paycheck', 'income',
];

function matchDirection(textLower: string): 'expense' | 'income' {
  return INCOME_TRIGGERS.some((w) => textLower.includes(w)) ? 'income' : 'expense';
}

// ---- entry point ----

export function parseUtterance(text: string, ctx: ParserContext): ParseResult {
  const textLower = text.toLowerCase();
  const tokens = textLower.match(new RegExp(WORD, 'g')) ?? [];

  const digitAmount = extractDigitAmount(text);
  const wordAmount = digitAmount === null ? extractWordAmount(tokens) : null;
  const amountCents = digitAmount !== null ? digitAmount : wordAmount !== null ? wordAmount * 100 : null;

  return {
    amountCents,
    direction: matchDirection(textLower),
    currency: extractCurrency(text),
    occurredAt: resolveRelativeDate(textLower, ctx.now),
    categoryId: matchCategory(textLower, ctx),
    accountId: matchAccount(textLower, ctx),
  };
}
