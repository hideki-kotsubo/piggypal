import type { Account, Category } from './types';

// docs/16 — Tier 1 (docs/04): a pure, on-device, closed-vocabulary rule
// parser. No React/store imports, no network. Never guesses between two
// plausible options — ambiguous fields come back null so the caller can
// degrade to the uncategorized inbox rather than write a wrong value.
//
// Merchant matching (docs/16 D150) is closed-vocabulary too: it only
// recognizes merchants the user has already used at least once (`ctx.
// merchants`), the same never-invent-an-unseen-value principle as
// category/account matching below. `guessNewMerchant` (docs/16 D151) is
// the one deliberate exception to "never guess": a narrow, pattern-based
// heuristic for a brand-new merchant never seen before ("at <Capitalized
// or domain-like token>"), surfaced with `merchantGuessed: true` so the
// caller can mark it as a guess rather than silently writing it — the
// same preview-then-confirm gate every other field already goes through
// (docs/22) is what makes this safe to attempt at all. True open-
// vocabulary extraction beyond this narrow shape is still Tier 2/AI
// territory, per docs/15 D77.
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
  merchant: string | null; // a confirmed match, or a guess — see merchantGuessed
  merchantGuessed: boolean; // true = guessNewMerchant's heuristic, not a confirmed ctx.merchants match
  unrecognized: string | null; // null = the whole utterance was recognized
}

// [start, end) character offsets into the original utterance (and,
// equally, into its lowercased form — toLowerCase() doesn't change string
// length for the Latin/Portuguese text this parser targets, so offsets
// computed against either string line up with both).
type Span = [number, number];

const WORD = '[a-zà-ÿ]+';

// ---- amount ----

// A bare currency symbol right before the digits ("$10.61") is cosmetic
// noise once the amount's extracted — stripped from the leftover too, but
// never used to set `currency`: a bare "$" stays genuinely ambiguous
// between USD/CAD (docs/10) — only an explicit marker like "R$"/"US$"
// does that, via extractCurrency.
const BARE_CURRENCY_SYMBOLS = ['$', '¥', '€', '£'];

// Bare integer "45" -> 4500 cents, matching docs/04's tool-schema
// description verbatim ("'45' means 4500. '12,50' means 1250.").
//
// Runs after date/time resolution (docs/16 D151) and skips any digit
// sequence already claimed by one of their spans — otherwise a day-first
// absolute date ("16 de agosto de 2026, 45 no mercado") or a clock time
// ("at 5:25pm I spent 45") would have its own digits mistaken for the
// amount, since both are digit sequences too and, in these phrasings,
// come before the real amount in the text.
function extractDigitAmount(text: string, spans: Span[]): number | null {
  const regex = /\d+(?:[.,]\d{1,2})?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some(([s, e]) => start < e && end > s)) continue;
    const symbolStart = start > 0 && BARE_CURRENCY_SYMBOLS.includes(text[start - 1]) ? start - 1 : start;
    spans.push([symbolStart, end]);
    const raw = match[0];
    const sepIndex = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
    if (sepIndex === -1) return Number(raw) * 100;
    const intPart = raw.slice(0, sepIndex) || '0';
    const decPart = raw.slice(sepIndex + 1).padEnd(2, '0');
    return Number(intPart) * 100 + Number(decPart);
  }
  return null;
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

// Relative-keyword and absolute (month-name) dates both resolve to a Date
// still carrying `now`'s time-of-day (matching the pre-existing "yesterday
// means yesterday, whatever time you're entering it" behavior) — a
// separate `resolveTimeOfDay` pass then overrides hours/minutes if the
// utterance also named a clock time, so "August 16th at 5:25pm" and
// "August 16th" (no time given) both resolve sensibly from the same base.
function resolveRelativeOrAbsoluteDate(textLower: string, now: Date, spans: Span[]): Date | null {
  const today = new RegExp(`\\b(hoje|today)\\b`).exec(textLower);
  if (today) {
    spans.push([today.index, today.index + today[0].length]);
    return new Date(now);
  }
  const anteontem = new RegExp(`\\banteontem\\b`).exec(textLower);
  if (anteontem) {
    spans.push([anteontem.index, anteontem.index + anteontem[0].length]);
    return shiftDays(now, 2);
  }
  const ontem = new RegExp(`\\b(ontem|yesterday)\\b`).exec(textLower);
  if (ontem) {
    spans.push([ontem.index, ontem.index + ontem[0].length]);
    return shiftDays(now, 1);
  }

  const lastEn = textLower.match(new RegExp(`\\blast\\s+(${WORD})\\b`));
  if (lastEn && lastEn[1] in WEEKDAY_INDEX) {
    spans.push([lastEn.index!, lastEn.index! + lastEn[0].length]);
    return lastWeekday(now, WEEKDAY_INDEX[lastEn[1]]);
  }

  const passadaPt =
    textLower.match(new RegExp(`\\b(${WORD})\\s+passad[ao]\\b`)) ?? textLower.match(new RegExp(`\\búltim[ao]\\s+(${WORD})\\b`));
  if (passadaPt && passadaPt[1] in WEEKDAY_INDEX) {
    spans.push([passadaPt.index!, passadaPt.index! + passadaPt[0].length]);
    return lastWeekday(now, WEEKDAY_INDEX[passadaPt[1]]);
  }

  return resolveAbsoluteDate(textLower, now, spans);
}

// ---- absolute date (docs/16 D151): "<Month> <day>[, <year>]" (English)
// or "<day> de <Month>[ de <year>]" (Portuguese). Year defaults to `now`'s
// — closed set of month names, bilingual, same shape as the rest of this
// file's vocab lists, not open-ended date parsing.
const MONTH_INDEX: Record<string, number> = {
  january: 0, jan: 0, janeiro: 0,
  february: 1, feb: 1, fevereiro: 1,
  march: 2, mar: 2, março: 2, marco: 2,
  april: 3, apr: 3, abril: 3,
  may: 4, maio: 4,
  june: 5, jun: 5, junho: 5,
  july: 6, jul: 6, julho: 6,
  august: 7, aug: 7, agosto: 7,
  september: 8, sep: 8, sept: 8, setembro: 8,
  october: 9, oct: 9, outubro: 9,
  november: 10, nov: 10, novembro: 10,
  december: 11, dec: 11, dezembro: 11,
};
const MONTH_NAMES = Object.keys(MONTH_INDEX).join('|');

function resolveAbsoluteDate(textLower: string, now: Date, spans: Span[]): Date | null {
  const en = new RegExp(`\\b(${MONTH_NAMES})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?\\b`).exec(textLower);
  if (en) {
    const day = Number(en[2]);
    if (day >= 1 && day <= 31) {
      spans.push([en.index, en.index + en[0].length]);
      const year = en[3] ? Number(en[3]) : now.getFullYear();
      return new Date(year, MONTH_INDEX[en[1]], day, now.getHours(), now.getMinutes(), now.getSeconds());
    }
  }

  const pt = new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${MONTH_NAMES})(?:\\s+de\\s+(\\d{4}))?\\b`).exec(textLower);
  if (pt) {
    const day = Number(pt[1]);
    if (day >= 1 && day <= 31) {
      spans.push([pt.index, pt.index + pt[0].length]);
      const year = pt[3] ? Number(pt[3]) : now.getFullYear();
      return new Date(year, MONTH_INDEX[pt[2]], day, now.getHours(), now.getMinutes(), now.getSeconds());
    }
  }

  return null;
}

// ---- time of day (docs/16 D151): "5:25pm", "5:25 PM", "17:25". A
// trailing parenthesized timezone abbreviation ("(PDT)") is recognized
// and removed from the leftover text but never applied — this app treats
// every date/time as the wall-clock value the user means, deliberately
// never doing UTC/timezone conversion (see `nowLocal()` in format.ts).
const TZ_ABBREVIATIONS = ['pst', 'pdt', 'mst', 'mdt', 'cst', 'cdt', 'est', 'edt', 'utc', 'gmt'];

function resolveTimeOfDay(textLower: string, spans: Span[]): { hours: number; minutes: number } | null {
  const match = /\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/.exec(textLower);
  if (!match) return null;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  if (match[3] === 'pm' && hours < 12) hours += 12;
  if (match[3] === 'am' && hours === 12) hours = 0;
  spans.push([match.index, match.index + match[0].length]);

  const tz = new RegExp(`\\(?\\b(${TZ_ABBREVIATIONS.join('|')})\\b\\)?`).exec(textLower);
  if (tz) spans.push([tz.index, tz.index + tz[0].length]);

  return { hours, minutes };
}

function resolveDate(textLower: string, now: Date, spans: Span[]): string | null {
  const base = resolveRelativeOrAbsoluteDate(textLower, now, spans);
  const time = resolveTimeOfDay(textLower, spans);
  if (!base && !time) return null;

  const result = base ? new Date(base) : new Date(now);
  if (time) result.setHours(time.hours, time.minutes, 0, 0);
  return toOccurredAt(result);
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
// same never-guess principle as category/account above. A brand-new
// merchant this function can't recognize gets one more chance, from
// `guessNewMerchant` below (docs/16 D151) — a narrow heuristic guess, not
// a confirmed match, kept clearly distinct via `merchantGuessed`.

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

// ---- new-merchant guess (docs/16 D151) — the one deliberate exception to
// this file's never-guess rule, and only because the caller (docs/22's
// parse-preview) always shows it for confirmation before Save writes
// anything, the same gate every defaulted currency/account/date already
// goes through. Grabs a single token right after "at"/"no"/"na" (en/pt for
// "at") — only one token, not a greedy multi-word capture, since there's
// no reliable way to tell "amazon.CA Toronto Can" apart into merchant vs.
// location without real NLU; under-capturing is a safer failure mode than
// over-capturing filler into what gets suggested as a merchant name.
// Requires a proper-noun-ish signal (starts uppercase, or contains a "."
// like a domain) so it doesn't fire on ordinary lowercase words ("arrived
// at work" shouldn't suggest "work" as a merchant) — and skips a token
// that overlaps a span some other field already claimed.

interface MerchantGuess {
  merchant: string;
  // The exact "at amazon.CA"-style substring, trigger word included —
  // protected from computeUnrecognized's edge trim (below) so it reads in
  // the Note the same way it was said, alongside the structured Merchant
  // field rather than instead of it.
  leadIn: string;
}

function guessNewMerchant(text: string, spans: Span[]): MerchantGuess | null {
  const match = /\b(?:at|no|na)\s+([^\s,]+)/i.exec(text);
  if (!match || match.index === undefined) return null;
  const raw = match[1];
  const candidate = raw.replace(/[.,]+$/, '');
  if (!candidate || /^\d/.test(candidate)) return null;
  if (!/[A-Z]/.test(candidate[0]) && !candidate.includes('.')) return null;

  const start = match.index + match[0].length - raw.length;
  const end = start + candidate.length;
  // Deliberately not claiming this span (unlike every other match in this
  // file): the user wants "at <merchant>" to stay readable in the Note
  // alongside the structured Merchant field, not disappear from it —
  // still skips a token some other field already claimed, so it never
  // guesses out of already-recognized text.
  if (spans.some(([s, e]) => start < e && end > s)) return null;
  return { merchant: candidate, leadIn: text.slice(match.index, end) };
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
//
// Cutting a span out of the middle of a sentence often strands a
// connector word or stray punctuation right at the new edge — "...Can on
// August 16th, 2026 at 5:25pm." with the date/time removed leaves
// "...Can on at ." Trimmed from the outside in only (never mid-string,
// where a leftover "at"/"on" might be genuinely meaningful, e.g. as part
// of the merchant guess's own lead-in).
const EDGE_FILLER_WORDS = new Set(['at', 'on', 'in', 'de', 'em', 'no', 'na']);

// `protect`, when given, is a phrase ("at amazon.CA") that must never be
// eaten by the trim even where one of its own words (typically the
// leading "at"/"no"/"na") would otherwise look like edge noise — found by
// exact word-run position, not by exempting the word everywhere, so an
// unrelated "at" elsewhere in the leftover is still trimmed normally.
function trimLeftoverEdges(s: string, protect: string | null): string {
  const isEdgeNoise = (w: string) => EDGE_FILLER_WORDS.has(w.toLowerCase()) || /^[.,;:!?]+$/.test(w);
  const words = s.split(' ');
  const protectWords = protect ? protect.split(' ') : [];

  let protectStart = -1;
  for (let i = 0; protectWords.length && i + protectWords.length <= words.length; i++) {
    if (protectWords.every((w, k) => words[i + k] === w)) {
      protectStart = i;
      break;
    }
  }
  const protectEnd = protectStart === -1 ? -1 : protectStart + protectWords.length; // exclusive
  const isProtected = (i: number) => protectStart !== -1 && i >= protectStart && i < protectEnd;

  let lo = 0;
  let hi = words.length;
  while (lo < hi && isEdgeNoise(words[lo]) && !isProtected(lo)) lo++;
  while (hi > lo && isEdgeNoise(words[hi - 1]) && !isProtected(hi - 1)) hi--;
  return words.slice(lo, hi).join(' ');
}

function computeUnrecognized(text: string, spans: Span[], protect: string | null): string | null {
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let leftover = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) leftover += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  leftover += text.slice(cursor);
  const cleaned = trimLeftoverEdges(leftover.replace(/\s+/g, ' ').trim(), protect);
  return cleaned || null;
}

// ---- entry point ----

export function parseUtterance(text: string, ctx: ParserContext): ParseResult {
  const textLower = text.toLowerCase();
  const tokens = Array.from(textLower.matchAll(new RegExp(WORD, 'g')));
  const spans: Span[] = [];

  // Date/time first (see extractDigitAmount's comment): both can contain
  // digit sequences that would otherwise be mistaken for the amount.
  const occurredAt = resolveDate(textLower, ctx.now, spans);

  const digitAmount = extractDigitAmount(text, spans);
  const wordAmount = digitAmount === null ? extractWordAmount(tokens, spans) : null;
  const amountCents = digitAmount !== null ? digitAmount : wordAmount !== null ? wordAmount * 100 : null;

  const direction = matchDirection(textLower, spans);
  const currency = extractCurrency(text, spans);
  const categoryId = matchCategory(textLower, ctx, spans);
  const accountId = matchAccount(textLower, ctx, spans);
  const confirmedMerchant = matchMerchant(textLower, ctx, spans);
  // Only try a guess once every other field (including the date/time/tz
  // spans above) has had its say — guessNewMerchant skips any token that
  // overlaps text something else already claimed.
  const guess = confirmedMerchant === null ? guessNewMerchant(text, spans) : null;

  return {
    amountCents,
    direction,
    currency,
    occurredAt,
    categoryId,
    accountId,
    merchant: confirmedMerchant ?? guess?.merchant ?? null,
    merchantGuessed: confirmedMerchant === null && guess !== null,
    unrecognized: computeUnrecognized(text, spans, guess?.leadIn ?? null),
  };
}
