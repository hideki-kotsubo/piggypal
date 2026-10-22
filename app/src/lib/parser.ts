import type { Account, Category } from './types';
import { mergedMap, mergedWords, orderedPacks, type LanguagePack } from './parserVocab';

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
//
// docs/73 D270: vocabulary lives in per-language packs (parserVocab.ts),
// all active for every utterance; `ctx.language` (the voice language for
// speech, the UI language for typed text) decides which pack wins when
// two languages read the same word differently.

export interface ParserContext {
  categories: Category[];
  keywords: { categoryId: string; keyword: string }[];
  accounts: Account[];
  merchants: string[];
  now: Date;
  // BCP 47 tag of the language the utterance is most likely in.
  language?: string;
  // True when the text came from speech-to-text rather than the keyboard.
  fromSpeech?: boolean;
  // Extra names for a category or account — the caller passes starter
  // names in every language (starterLabels.ts, docs/73 D266/D267), so
  // "épicerie" finds the starter Groceries category even though its
  // stored name is English.
  categoryAliases?: { categoryId: string; alias: string }[];
  accountAliases?: { accountId: string; alias: string }[];
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
  // docs/73 D272: "dollars" or a bare "$" with no country — some dollar
  // currency, which one is the caller's to resolve. Only true when
  // `currency` is null.
  dollarFamily: boolean;
  unrecognized: string | null; // null = the whole utterance was recognized
}

// [start, end) character offsets into the original utterance (and,
// equally, into its lowercased form — toLowerCase() doesn't change string
// length for the Latin/Portuguese text this parser targets, so offsets
// computed against either string line up with both).
type Span = [number, number];

const WORD = '[a-zà-ÿ]+';

// Whole-word search, accent-aware (JS's \b treats "é" as a non-word
// character, so "café\b" never matches). Returns the match index or -1.
// A phrase in a CJK script is a plain substring search (docs/76):
// Japanese and Chinese have no spaces to bound a word.
const CJK_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function findWord(textLower: string, phrase: string): number {
  if (CJK_SCRIPT.test(phrase)) return textLower.indexOf(phrase);
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'u').exec(textLower);
  return match ? match.index : -1;
}

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
//
// Thousands separators (docs/76): "1,500" and "1.500" are 1500, not 1.50
// — groups of exactly three digits after a separator are thousands, and
// only a final one- or two-digit group is cents ("1.500,50", "1,500.50").
function extractDigitAmount(text: string, spans: Span[]): number | null {
  const regex = /\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?(?!\d)|\d+(?:[.,]\d{1,2})?/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some(([s, e]) => start < e && end > s)) continue;
    const symbolStart = start > 0 && BARE_CURRENCY_SYMBOLS.includes(text[start - 1]) ? start - 1 : start;
    spans.push([symbolStart, end]);
    let raw = match[0];
    const grouped = /^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?$/.exec(raw);
    if (grouped) {
      const cents = /[.,](\d{1,2})$/.exec(raw);
      const whole = (cents ? raw.slice(0, -cents[0].length) : raw).replace(/[.,]/g, '');
      raw = cents ? `${whole}.${cents[1]}` : whole;
    }
    const sepIndex = Math.max(raw.lastIndexOf('.'), raw.lastIndexOf(','));
    if (sepIndex === -1) return Number(raw) * 100;
    const intPart = raw.slice(0, sepIndex) || '0';
    const decPart = raw.slice(sepIndex + 1).padEnd(2, '0');
    return Number(intPart) * 100 + Number(decPart);
  }
  return null;
}

// ---- CJK amounts (docs/76): 3万円, 1万5千円, 千五百円, 1.5万円, 1,500円.
// A run of digits/numerals counts as an amount when a counter like 円
// follows it, or when it mixes digits with a unit (3万), so words that
// merely contain a numeral (一緒, 十分) are left alone.

function parseCjkNumber(
  run: string,
  digits: Record<string, number>,
  small: Record<string, number>,
  large: Record<string, number>,
): number | null {
  let total = 0;
  let section = 0;
  let current: number | null = null;
  let literal = '';
  let prevDigit = false;
  const flush = () => {
    if (literal) {
      const n = Number(literal.replace(/,/g, ''));
      current = Number.isFinite(n) ? n : null;
      literal = '';
    }
  };
  for (const ch of run) {
    if (/[0-9.,]/.test(ch)) {
      literal += ch;
      prevDigit = false;
      continue;
    }
    flush();
    if (ch in digits) {
      // 二〇二六-style runs read positionally.
      current = prevDigit && current !== null ? current * 10 + digits[ch] : digits[ch];
      prevDigit = true;
    } else if (ch in small) {
      section += (current ?? 1) * small[ch];
      current = null;
      prevDigit = false;
    } else if (ch in large) {
      total += (section + (current ?? 0) || 1) * large[ch];
      section = 0;
      current = null;
      prevDigit = false;
    } else {
      return null;
    }
  }
  flush();
  return total + section + (current ?? 0);
}

function extractCjkAmount(text: string, spans: Span[], language: string | undefined): number | null {
  const withNumerals = orderedPacks(language).filter(({ pack }) => pack.numerals);
  if (withNumerals.length === 0) return null;
  const digits: Record<string, number> = {};
  const small: Record<string, number> = {};
  const large: Record<string, number> = {};
  for (const { pack } of withNumerals) {
    for (const [k, v] of Object.entries(pack.numerals!.digits)) if (!(k in digits)) digits[k] = v;
    for (const [k, v] of Object.entries(pack.numerals!.small)) if (!(k in small)) small[k] = v;
    for (const [k, v] of Object.entries(pack.numerals!.large)) if (!(k in large)) large[k] = v;
  }
  const counters = mergedWords(language, (p) => p.amountCounters ?? []);
  const chars = Object.keys({ ...digits, ...small, ...large }).join('');
  const run = new RegExp(`[0-9${chars}](?:[0-9.,${chars}]*[0-9${chars}])?`, 'g');
  let match: RegExpExecArray | null;
  while ((match = run.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (spans.some(([s, e]) => start < e && end > s)) continue;
    const counter = counters.find((c) => text.startsWith(c, end));
    const hasUnit = [...match[0]].some((ch) => ch in small || ch in large);
    if (!counter && !(hasUnit && /[0-9]/.test(match[0]))) continue;
    const value = parseCjkNumber(match[0], digits, small, large);
    if (value === null || value <= 0) continue;
    spans.push([start, end + (counter?.length ?? 0)]);
    return Math.round(value * 100);
  }
  return null;
}

// Fallback for when speech-to-text or typed input spells numbers out
// ("quarenta e cinco", "forty five", "treinta y cinco", "soixante-dix")
// instead of using digits — whole amounts only, no cents from word form.
// Units, teens and tens from every language pack, "<tens> and <units>"
// compounds, plus French's dix-sept, soixante-dix and quatre-vingt(-dix).

interface WordNumber {
  value: number;
  start: number;
  end: number;
  isArticle: boolean;
}

function readWordNumber(
  tokens: RegExpMatchArray[],
  i: number,
  numbers: Record<string, number>,
  joiners: string[],
  articles: string[],
): WordNumber | null {
  const at = (k: number) => tokens[k]?.[0];
  const num = (k: number) => {
    const w = at(k);
    return w !== undefined && w in numbers ? numbers[w] : undefined;
  };
  let value = num(i);
  if (value === undefined) return null;
  const start = tokens[i].index!;
  let last = i;

  // quatre-vingt(s) = 80
  if (at(i) === 'quatre' && (at(i + 1) === 'vingt' || at(i + 1) === 'vingts')) {
    value = 80;
    last = i + 1;
  }
  // French teens past 16: dix-sept/huit/neuf
  const teen = (k: number): [number, number] | null => {
    if (num(k) === 10 && at(k) === 'dix') {
      const unit = num(k + 1);
      if (unit !== undefined && unit >= 7 && unit <= 9) return [10 + unit, k + 1];
    }
    const v = num(k);
    return v !== undefined && v < 20 ? [v, k] : null;
  };
  if (value === 10 && at(i) === 'dix') {
    const t = teen(i);
    if (t) [value, last] = t;
  }
  // Tens followed by a unit (or, after soixante/quatre-vingt, a teen).
  if (value >= 20 && value % 10 === 0 && value < 100) {
    let j = last + 1;
    if (joiners.includes(at(j) ?? '')) j++;
    const allowsTeen = value === 60 || value === 80;
    const t = teen(j);
    if (t && (t[0] < 10 || allowsTeen) && t[0] > 0) {
      value += t[0];
      last = t[1];
    }
  }
  const lastToken = tokens[last];
  return {
    value,
    start,
    end: lastToken.index! + lastToken[0].length,
    isArticle: last === i && articles.includes(at(i)!),
  };
}

function extractWordAmount(tokens: RegExpMatchArray[], spans: Span[], language: string | undefined): number | null {
  const numbers = mergedMap(language, (p) => p.numbers);
  const joiners = mergedWords(language, (p) => p.numberJoiners);
  const articles = mergedWords(language, (p) => p.articles);
  const found: WordNumber[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const n = readWordNumber(tokens, i, numbers, joiners, articles);
    if (!n) continue;
    found.push(n);
    while (i + 1 < tokens.length && tokens[i + 1].index! < n.end) i++;
  }
  // "um café cinco reais" — the "one" is an article, not the amount,
  // whenever some other number word is there to be the amount.
  const pick = found.find((n) => !n.isArticle) ?? found[0];
  if (!pick) return null;
  spans.push([pick.start, pick.end]);
  return pick.value;
}

// ---- currency (explicit markers only — never inferred from amount size
// or vocabulary, per docs/04) ----

// Country-qualified dollars come first, so "dólares canadenses" is CAD
// before the bare "dólares" rule (Portuguese and Latin American Spanish
// usage: plain "dólares" means US dollars) can claim it.
const CURRENCY_MARKERS: [RegExp, string][] = [
  [/\b(?:canadian dollars?|dollars? canadiens?|d[óo]lar(?:es)? canadenses?|d[óo]lar(?:es)? canadienses?)(?![\p{L}])/iu, 'CAD'],
  [/\b(?:american dollars?|u\.?s\.? dollars?|dollars? am[ée]ricains?|dollars? us|d[óo]lar(?:es)? americanos?|d[óo]lar(?:es)? estadunidenses?|d[óo]lar(?:es)? estadounidenses?)(?![\p{L}])/iu, 'USD'],
  // docs/76 — Japanese.
  [/(?:カナダドル|加ドル)/, 'CAD'], [/(?:米ドル|アメリカドル|usドル)/i, 'USD'],
  [/円/, 'JPY'], [/ユーロ/, 'EUR'], [/レアル/, 'BRL'],
  [/r\$/i, 'BRL'], [/\breais?\b/i, 'BRL'], [/\breal\b/i, 'BRL'],
  [/¥/, 'JPY'], [/\bienes?\b/i, 'JPY'], [/\byen(?:es|s)?\b/i, 'JPY'],
  [/€/, 'EUR'], [/\beuros?\b/i, 'EUR'],
  [/us\$/i, 'USD'], [/\busd\b/i, 'USD'], [/\bdólares?\b/i, 'USD'], [/\bdolares?\b/i, 'USD'],
  [/\bcad\b/i, 'CAD'], [/c\$/i, 'CAD'],
];

// docs/73 D272: "dollars"/"bucks" with no country — a dollar, but which
// one depends on the person (CAD in Vancouver, USD on a trip), so the
// caller picks.
const DOLLAR_WORDS = /\b(?:dollars?|bucks?)\b|ドル/i;

function extractCurrency(text: string, spans: Span[], ctx: ParserContext): { currency: string | null; dollarFamily: boolean } {
  for (const [re, code] of CURRENCY_MARKERS) {
    const match = re.exec(text);
    if (match) {
      spans.push([match.index, match.index + match[0].length]);
      return { currency: code, dollarFamily: false };
    }
  }
  const word = DOLLAR_WORDS.exec(text);
  if (word) {
    spans.push([word.index, word.index + word[0].length]);
    return { currency: null, dollarFamily: true };
  }
  // No explicit marker matched, so any "$" left is bare; what it means
  // depends on the input language (parserVocab.ts's dollarSign).
  const dollar = text.indexOf('$');
  if (dollar === -1) return { currency: null, dollarFamily: false };
  const sign = orderedPacks(ctx.language)[0].pack.dollarSign;
  const meaning = ctx.fromSpeech ? sign.speech : sign.typed;
  if (meaning === 'none') return { currency: null, dollarFamily: false };
  spans.push([dollar, dollar + 1]);
  return meaning === 'USD' ? { currency: 'USD', dollarFamily: false } : { currency: null, dollarFamily: true };
}

// ---- relative date (closed set only — defaults to `now` in the caller
// when this returns null) ----

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
// The given weekday in the previous calendar week, weeks starting on
// Monday: on Friday 16 Oct, 先週の月曜 is 5 Oct (not the 12th).
function previousWeekWeekday(now: Date, targetDow: number): Date {
  const sinceMonday = (now.getDay() + 6) % 7;
  return shiftDays(now, sinceMonday + 7 - ((targetDow + 6) % 7));
}

function firstWordMatch(textLower: string, words: string[]): [number, number] | null {
  let best: [number, number] | null = null;
  for (const w of words) {
    const idx = findWord(textLower, w);
    if (idx !== -1 && (!best || idx < best[0])) best = [idx, idx + w.length];
  }
  return best;
}

function resolveRelativeOrAbsoluteDate(textLower: string, now: Date, spans: Span[], language: string | undefined): Date | null {
  const today = firstWordMatch(textLower, mergedWords(language, (p) => p.today));
  if (today) {
    spans.push(today);
    return new Date(now);
  }
  // Before "yesterday": "antes de ayer" / "avant-hier" contain it.
  const dayBefore = firstWordMatch(textLower, mergedWords(language, (p) => p.dayBeforeYesterday));
  if (dayBefore) {
    spans.push(dayBefore);
    return shiftDays(now, 2);
  }
  const yesterday = firstWordMatch(textLower, mergedWords(language, (p) => p.yesterday));
  if (yesterday) {
    spans.push(yesterday);
    return shiftDays(now, 1);
  }

  const weekdays = mergedMap(language, (p) => p.weekdays);
  // "<weekday> of last week" (先週の月曜) before the plain weekday, which
  // it contains.
  for (const { pack } of orderedPacks(language)) {
    for (const source of pack.previousWeekWeekday ?? []) {
      const match = textLower.match(new RegExp(source));
      if (match && match[1] in weekdays) {
        spans.push([match.index!, match.index! + match[0].length]);
        return previousWeekWeekday(now, weekdays[match[1]]);
      }
    }
  }
  for (const { pack } of orderedPacks(language)) {
    for (const source of pack.lastWeekday) {
      const match = textLower.match(new RegExp(source));
      if (match && match[1] in weekdays) {
        spans.push([match.index!, match.index! + match[0].length]);
        return lastWeekday(now, weekdays[match[1]]);
      }
    }
  }

  return resolveAbsoluteDate(textLower, now, spans, language);
}

// ---- absolute date (docs/16 D151): "<Month> <day>[, <year>]" (English),
// "<day> de <Month>[ de <year>]" (Portuguese, Spanish) or
// "<day>[er] <Month>[ <year>]" (French). Year defaults to `now`'s — closed
// set of month names per language pack, not open-ended date parsing. The
// English and "de" shapes accept every non-French month name (as before
// docs/73, when English and Portuguese names shared one list); the French
// shape only French names, so "uber 12 jan" stays an amount.
function monthPattern(names: string[]): string {
  return [...names].sort((a, b) => b.length - a.length).join('|');
}

function resolveAbsoluteDate(textLower: string, now: Date, spans: Span[], language: string | undefined): Date | null {
  const months = mergedMap(language, (p) => p.months);
  const styled = (style: LanguagePack['dateStyle']) =>
    monthPattern(
      orderedPacks(language)
        .filter(({ pack }) => (style === 'dayMonth' ? pack.dateStyle === 'dayMonth' : pack.dateStyle !== 'dayMonth'))
        .flatMap(({ pack }) => Object.keys(pack.months))
        .filter((m) => m in months),
    );
  const at = (day: number, monthName: string, yearText: string | undefined) =>
    new Date(yearText ? Number(yearText) : now.getFullYear(), months[monthName], day, now.getHours(), now.getMinutes(), now.getSeconds());
  const nonFrench = styled('monthDay');
  const french = styled('dayMonth');

  // Each shape: regex, and which groups hold [day, month, year].
  // cjk (docs/76): 8月16日 / 2026年8月16日, the month as a number.
  const shapes: Record<LanguagePack['dateStyle'], [RegExp, [number, number, number]] | null> = {
    cjk: [/(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日/, [3, 2, 1]],
    monthDay: [new RegExp(`\\b(${nonFrench})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?(?:\\s+(\\d{4}))?\\b`), [2, 1, 3]],
    dayDeMonth: [new RegExp(`\\b(\\d{1,2})\\s+de\\s+(${nonFrench})(?:\\s+de\\s+(\\d{4}))?\\b`), [1, 2, 3]],
    dayMonth: french ? [new RegExp(`\\b(\\d{1,2})(?:er)?\\s+(${french})\\.?(?:\\s+(\\d{4}))?(?![\\p{L}])`, 'u'), [1, 2, 3]] : null,
  };
  // The input language's own shape first: "15 de marzo 30" is the 15th,
  // not English-style "marzo 30".
  const order = [...new Set([orderedPacks(language)[0].pack.dateStyle, 'monthDay', 'dayDeMonth', 'dayMonth', 'cjk'] as const)];
  for (const style of order) {
    const shape = shapes[style];
    if (!shape) continue;
    const [re, [d, m, y]] = shape;
    const match = re.exec(textLower);
    if (!match) continue;
    const dayOfMonth = Number(match[d]);
    if (dayOfMonth < 1 || dayOfMonth > 31) continue;
    spans.push([match.index, match.index + match[0].length]);
    if (style === 'cjk') {
      const month = Number(match[m]);
      if (month < 1 || month > 12) continue;
      const year = match[y] ? Number(match[y]) : now.getFullYear();
      return new Date(year, month - 1, dayOfMonth, now.getHours(), now.getMinutes(), now.getSeconds());
    }
    return at(dayOfMonth, match[m], match[y]);
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
  if (!match) return resolveCjkTime(textLower, spans);
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

// docs/76: 15時30分, 午後3時, 午後3時半. "3時間" is a duration (hours), not
// a time, so 時 followed by 間 doesn't count.
function resolveCjkTime(textLower: string, spans: Span[]): { hours: number; minutes: number } | null {
  const match = /(午前|午後)?\s*(\d{1,2})時(?!間)(?:\s*(\d{1,2})分|(半))?/.exec(textLower);
  if (!match) return null;
  let hours = Number(match[2]);
  const minutes = match[4] ? 30 : match[3] ? Number(match[3]) : 0;
  if (hours > 23 || minutes > 59) return null;
  if (match[1] === '午後' && hours < 12) hours += 12;
  if (match[1] === '午前' && hours === 12) hours = 0;
  spans.push([match.index, match.index + match[0].length]);
  return { hours, minutes };
}

function resolveDate(textLower: string, now: Date, spans: Span[], language: string | undefined): string | null {
  const base = resolveRelativeOrAbsoluteDate(textLower, now, spans, language);
  const time = resolveTimeOfDay(textLower, spans);
  if (!base && !time) return null;

  const result = base ? new Date(base) : new Date(now);
  if (time) result.setHours(time.hours, time.minutes, 0, 0);
  return toOccurredAt(result);
}

// ---- category (never-guess: exactly one distinct match, else null) ----

// Two kinds of vocabulary: the user's own (category names, saved
// keywords) keeps its original substring matching; the built-in language
// packs and starter aliases (docs/73) match whole words only, since they
// carry short words like "bus" or "resto" that must not fire inside
// longer ones.
function matchCategory(textLower: string, ctx: ParserContext, spans: Span[]): string | null {
  const vocab = new Map<string, { categoryId: string; wholeWord: boolean }>();
  for (const k of ctx.keywords) vocab.set(k.keyword.toLowerCase(), { categoryId: k.categoryId, wholeWord: false });
  for (const c of ctx.categories) {
    const key = c.name.toLowerCase();
    if (!vocab.has(key)) vocab.set(key, { categoryId: c.id, wholeWord: false });
  }
  // Same empty-string trap as matchAccount: a cleared name or keyword
  // would match every text.
  for (const key of [...vocab.keys()]) if (key.trim() === '') vocab.delete(key);
  const active = new Set(ctx.categories.filter((c) => !c.archived).map((c) => c.id));
  for (const a of ctx.categoryAliases ?? []) {
    const key = a.alias.toLowerCase();
    if (!vocab.has(key)) vocab.set(key, { categoryId: a.categoryId, wholeWord: true });
  }
  for (const { pack } of orderedPacks(ctx.language)) {
    for (const [categoryId, words] of Object.entries(pack.categoryKeywords)) {
      if (!active.has(categoryId)) continue;
      for (const w of words) if (!vocab.has(w)) vocab.set(w, { categoryId, wholeWord: true });
    }
  }
  // Text already read as the amount or date can't also be a keyword: the
  // starter keyword "99" (the ride app) used to match inside "16.99",
  // making every price ending in 99 ambiguous with Rideshare.
  const claimed = [...spans];
  const free = (idx: number, len: number) => !claimed.some(([s, e]) => idx < e && idx + len > s);
  const find = (keyword: string, wholeWord: boolean) => {
    if (wholeWord) {
      const idx = findWord(textLower, keyword);
      return idx !== -1 && free(idx, keyword.length) ? idx : -1;
    }
    for (let idx = textLower.indexOf(keyword); idx !== -1; idx = textLower.indexOf(keyword, idx + 1)) {
      if (free(idx, keyword.length)) return idx;
    }
    return -1;
  };

  const hits = new Map<string, Span[]>();
  for (const [keyword, { categoryId, wholeWord }] of vocab) {
    const idx = find(keyword, wholeWord);
    if (idx === -1) continue;
    hits.set(categoryId, [...(hits.get(categoryId) ?? []), [idx, idx + keyword.length]]);
  }
  // A keyword found only inside a longer keyword of another category
  // doesn't count (docs/76): アイス (snacks) inside アイスコーヒー (coffee).
  const inside = ([s, e]: Span, [s2, e2]: Span) => s2 <= s && e <= e2 && e2 - s2 > e - s;
  const matched = new Set<string>();
  for (const [id, own] of hits) {
    const others = [...hits].filter(([other]) => other !== id).flatMap(([, s]) => s);
    if (!own.every((span) => others.some((o) => inside(span, o)))) matched.add(id);
  }
  // A group and its own subcategory both matching ("transporte uber")
  // means the subcategory, not an ambiguity.
  for (const id of [...matched]) {
    const parentId = ctx.categories.find((c) => c.id === id)?.parentId;
    if (parentId && matched.has(parentId)) matched.delete(parentId);
  }
  if (matched.size !== 1) return null;
  const categoryId = [...matched][0];
  // Every keyword that resolved to the winning category (or its group)
  // counts as recognized text, not just the first one found — "mercado"
  // and "grocery" both appearing shouldn't leave one of them as leftover.
  const winnerParent = ctx.categories.find((c) => c.id === categoryId)?.parentId;
  for (const [keyword, { categoryId: id, wholeWord }] of vocab) {
    if (id !== categoryId && id !== winnerParent) continue;
    const idx = find(keyword, wholeWord);
    if (idx !== -1) spans.push([idx, idx + keyword.length]);
  }
  return categoryId;
}

// ---- account (exact-name match only, no fuzzy matching, per docs/04) ----

function matchAccount(textLower: string, ctx: ParserContext, spans: Span[]): string | null {
  // An empty name or institution is "contained" in every text, so an
  // account whose name was cleared in the edit form used to match every
  // entry (real report, 2026-10-16: "Cash —" picked with no "default").
  const accounts = ctx.accounts.filter((a) => a.name.trim() !== '');
  // An institution+name pair both present is an explicit disambiguation
  // ("no Visa do TD") — trust it even if the bare name alone is shared by
  // another account.
  const disambiguated = accounts.filter(
    (a) => a.institution?.trim() && textLower.includes(a.institution.toLowerCase()) && textLower.includes(a.name.toLowerCase()),
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
  // doc04's own example) unless exactly one account matches. A starter
  // account's name in other languages counts too ("dinheiro" for the
  // starter Cash account, docs/73 D267), whole words only.
  const byName = accounts.filter((a) => textLower.includes(a.name.toLowerCase()));
  const byAlias = (ctx.accountAliases ?? []).filter((a) => findWord(textLower, a.alias.toLowerCase()) !== -1);
  const distinctIds = new Set([...byName.map((a) => a.id), ...byAlias.map((a) => a.accountId)]);
  if (distinctIds.size !== 1) return null;
  if (byName.length > 0) {
    const nameIdx = textLower.indexOf(byName[0].name.toLowerCase());
    if (nameIdx !== -1) spans.push([nameIdx, nameIdx + byName[0].name.length]);
    return byName[0].id;
  }
  const alias = byAlias[0].alias.toLowerCase();
  const aliasIdx = findWord(textLower, alias);
  spans.push([aliasIdx, aliasIdx + alias.length]);
  return byAlias[0].accountId;
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
    if (m.trim() && textLower.includes(m.toLowerCase())) matched.add(m);
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

function guessNewMerchant(text: string, spans: Span[], language: string | undefined): MerchantGuess | null {
  // "at" / "no", "na" / "en" / "chez", "au" — minus any the input language
  // reserves (Spanish "no" is "not", never "in the").
  const connectors = mergedWords(language, (p) => p.merchantConnectors).join('|');
  const match = new RegExp(`(?<![\\p{L}\\p{N}])(?:${connectors})\\s+([^\\s,]+)`, 'iu').exec(text);
  if (!match || match.index === undefined) return guessMerchantBeforeParticle(text, spans, language);
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

function matchDirection(textLower: string, spans: Span[], language: string | undefined): 'expense' | 'income' {
  for (const w of mergedWords(language, (p) => p.incomeTriggers)) {
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
// `protect`, when given, is a phrase ("at amazon.CA") that must never be
// eaten by the trim even where one of its own words (typically the
// leading "at"/"no"/"na") would otherwise look like edge noise — found by
// exact word-run position, not by exempting the word everywhere, so an
// unrelated "at" elsewhere in the leftover is still trimmed normally.
function trimLeftoverEdges(s: string, protect: string | null, fillers: Set<string>): string {
  const isEdgeNoise = (w: string) => fillers.has(w.toLowerCase()) || /^[.,;:!?]+$/.test(w);
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

// docs/76 — Japanese puts the place before the particle: "スタバでコーヒー".
// Katakana or Latin letters right before で are guessed as a new merchant
// (shop names are mostly written that way); kanji words before で are
// usually not shops (現金で = "with cash"). Same never-claims rule as
// above, so a word another field already read (カフェ as a category)
// is never guessed.
function guessMerchantBeforeParticle(text: string, spans: Span[], language: string | undefined): MerchantGuess | null {
  const particles = mergedWords(language, (p) => p.merchantAfter ?? []);
  if (particles.length === 0) return null;
  const re = new RegExp(`([\\p{Script=Katakana}ー・A-Za-z0-9&.'’]{2,})(?:${particles.join('|')})`, 'gu');
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[1].length;
    if (/^\d+$/.test(match[1]) || spans.some(([s, e]) => start < e && end > s)) continue;
    return { merchant: match[1], leadIn: match[0] };
  }
  return null;
}

// Character-wise particle trim for text without spaces (docs/76): the
// note "スタバで" or "で" after the rest was read shouldn't keep a
// dangling particle. The merchant guess's own lead-in stays.
function trimLeftoverParticles(s: string, protect: string | null, particles: string[]): string {
  if (particles.includes(s)) return '';
  const sorted = [...particles].sort((a, b) => b.length - a.length);
  let changed = true;
  while (changed && s) {
    changed = false;
    for (const p of sorted) {
      if (s.length > p.length && s.startsWith(p) && !(protect && s.startsWith(protect))) {
        s = s.slice(p.length).trim();
        changed = true;
      }
      if (s.length > p.length && s.endsWith(p) && !(protect && s.endsWith(protect))) {
        s = s.slice(0, -p.length).trim();
        changed = true;
      }
    }
  }
  return particles.includes(s) ? '' : s;
}

function computeUnrecognized(text: string, spans: Span[], protect: string | null, language: string | undefined): string | null {
  const fillers = new Set(mergedWords(language, (p) => p.edgeFillers));
  const sorted = [...spans].sort((a, b) => a[0] - b[0]);
  let leftover = '';
  let cursor = 0;
  for (const [start, end] of sorted) {
    if (start > cursor) leftover += text.slice(cursor, start);
    cursor = Math.max(cursor, end);
  }
  leftover += text.slice(cursor);
  let cleaned = trimLeftoverEdges(leftover.replace(/\s+/g, ' ').trim(), protect, fillers);
  if (CJK_SCRIPT.test(cleaned)) {
    cleaned = trimLeftoverParticles(cleaned, protect, mergedWords(language, (p) => p.edgeParticles ?? []));
  }
  return cleaned || null;
}

// ---- entry point ----

// Full-width ASCII (１５００, ＄, Ａ) and the ideographic space become their
// plain forms, one character for one, so every span still lines up with
// the text (docs/76). Japanese keyboards and some dictation produce them.
function normalizeWidth(text: string): string {
  return text.replace(/[\uFF01-\uFF5E]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0)).replace(/\u3000/g, ' ');
}

export function parseUtterance(rawText: string, ctx: ParserContext): ParseResult {
  const text = normalizeWidth(rawText);
  const textLower = text.toLowerCase();
  const tokens = Array.from(textLower.matchAll(new RegExp(WORD, 'g')));
  const spans: Span[] = [];

  // Date/time first (see extractDigitAmount's comment): both can contain
  // digit sequences that would otherwise be mistaken for the amount.
  const occurredAt = resolveDate(textLower, ctx.now, spans, ctx.language);

  // CJK forms first (3万円 would otherwise read as 3), then plain digits.
  const digitAmount = extractCjkAmount(text, spans, ctx.language) ?? extractDigitAmount(text, spans);
  const wordAmount = digitAmount === null ? extractWordAmount(tokens, spans, ctx.language) : null;
  const amountCents = digitAmount !== null ? digitAmount : wordAmount !== null ? wordAmount * 100 : null;

  // Category before direction: an income word that is also a keyword
  // ("salary", 給料) would otherwise be claimed by matchDirection first,
  // and matchCategory skips claimed text.
  const categoryId = matchCategory(textLower, ctx, spans);
  const direction = matchDirection(textLower, spans, ctx.language);
  const { currency, dollarFamily } = extractCurrency(text, spans, ctx);
  const accountId = matchAccount(textLower, ctx, spans);
  const confirmedMerchant = matchMerchant(textLower, ctx, spans);
  // Only try a guess once every other field (including the date/time/tz
  // spans above) has had its say — guessNewMerchant skips any token that
  // overlaps text something else already claimed.
  const guess = confirmedMerchant === null ? guessNewMerchant(text, spans, ctx.language) : null;

  return {
    amountCents,
    direction,
    currency,
    occurredAt,
    categoryId,
    accountId,
    merchant: confirmedMerchant ?? guess?.merchant ?? null,
    merchantGuessed: confirmedMerchant === null && guess !== null,
    dollarFamily,
    unrecognized: computeUnrecognized(text, spans, guess?.leadIn ?? null, ctx.language),
  };
}
