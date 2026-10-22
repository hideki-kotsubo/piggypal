// docs/73 D270 — the Tier 1 parser's closed vocabulary, one pack per
// language. Every pack is active for every utterance (people mix
// languages), but the input language's pack comes first, and its
// `reserved` words switch off other languages' readings of the same word:
// Spanish "no" is "not", never Portuguese "in the"; French "sept" is seven,
// never English "Sept"; Portuguese "dos" is "of the", never Spanish two.
// No React, no i18n — parser.ts stays a pure module.

export type PackId = 'en' | 'pt' | 'es' | 'fr' | 'ja';

export interface LanguagePack {
  numbers: Record<string, number>;
  // Words joining tens and units: "forty and five", "quarenta e cinco",
  // "treinta y cinco", "vingt et un".
  numberJoiners: string[];
  // "One"-valued words that are usually an article ("um café", "un café"):
  // only read as an amount when nothing else is.
  articles: string[];
  today: string[];
  yesterday: string[];
  dayBeforeYesterday: string[];
  weekdays: Record<string, number>;
  // Regex sources with one capture group for the weekday name.
  lastWeekday: string[];
  months: Record<string, number>;
  // monthDay: "August 16, 2026"; dayDeMonth: "16 de agosto de 2026";
  // dayMonth: "16 août 2026" / "le 1er mai".
  // cjk: 8月16日 / 2026年8月16日 (docs/76), months by number.
  dateStyle: 'monthDay' | 'dayDeMonth' | 'dayMonth' | 'cjk';
  incomeTriggers: string[];
  // Single words right before a new merchant's name ("at Costco").
  merchantConnectors: string[];
  // Connector words trimmed from the edges of the leftover note.
  edgeFillers: string[];
  // Built-in keywords for starter categories (seed.ts ids), so existing
  // installs get them without reseeding category_keywords.
  categoryKeywords: Record<string, string[]>;
  reserved: string[];
  // What a bare "$" means, typed and in speech-to-text output: 'family' =
  // some dollar (CAD, USD…), resolved by the caller (docs/73 D272);
  // 'USD' = exactly that; 'none' = not a dollar at all. iOS's Portuguese
  // dictation writes "cem dólares" as "$100" (reais come out as "R$"), so
  // in Portuguese speech "$" is US dollars. In Spanish "$" is just as
  // often pesos (Mexico, Argentina…), so it means nothing there.
  dollarSign: { typed: 'family' | 'USD' | 'none'; speech: 'family' | 'USD' | 'none' };

  // docs/76 — languages written without spaces between words. Their
  // vocabulary matches as plain substrings: parser.ts's findWord skips the
  // word-boundary check for any phrase in a CJK script.
  noSpaces?: boolean;
  // "<weekday> of last week" (先週の月曜): one capture group for the
  // weekday, looked up in `weekdays`. Unlike `lastWeekday` ("the most
  // recent Monday"), this is the previous calendar week's.
  previousWeekWeekday?: string[];
  // Numerals for amounts written with them or with mixed digits: 3万円,
  // 1万5千円, 千五百円. `small` multiplies within a group (十百千),
  // `large` closes a group (万億).
  numerals?: { digits: Record<string, number>; small: Record<string, number>; large: Record<string, number> };
  // A word right after a number that makes it an amount (円).
  amountCounters?: string[];
  // Particles right after a new merchant's name (スタバで): the name comes
  // before them, unlike `merchantConnectors`.
  merchantAfter?: string[];
  // Particles trimmed off the edges of the leftover note, character-wise.
  edgeParticles?: string[];
}

const W = '([a-zà-ÿ]+)';

export const PACKS: Record<PackId, LanguagePack> = {
  en: {
    numbers: {
      zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
      eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
      eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
      eighty: 80, ninety: 90, hundred: 100,
    },
    numberJoiners: ['and'],
    articles: ['one'],
    today: ['today'],
    yesterday: ['yesterday'],
    dayBeforeYesterday: [],
    weekdays: { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 },
    lastWeekday: [`\\blast\\s+${W}\\b`],
    months: {
      january: 0, jan: 0, february: 1, feb: 1, march: 2, mar: 2, april: 3, apr: 3, may: 4, june: 5, jun: 5,
      july: 6, jul: 6, august: 7, aug: 7, september: 8, sep: 8, sept: 8, october: 9, oct: 9, november: 10,
      nov: 10, december: 11, dec: 11,
    },
    dateStyle: 'monthDay',
    incomeTriggers: ['salary', 'deposit', 'received', 'got paid', 'paycheck', 'income'],
    merchantConnectors: ['at'],
    edgeFillers: ['at', 'on', 'in'],
    categoryKeywords: {
      'cat-food-groceries': ['grocery', 'groceries', 'supermarket'],
      'cat-food-dining': ['restaurant', 'lunch', 'dinner', 'breakfast'],
      'cat-food-coffee': ['coffee', 'latte', 'cappuccino'],
      'cat-transport-rideshare': ['uber', 'lyft', 'taxi', 'cab'],
      'cat-transport-fuel': ['gas', 'fuel', 'gasoline'],
      'cat-transport-transit': ['bus', 'subway', 'train'],
      'cat-transport-parking': ['parking'],
      'cat-health-pharmacy': ['pharmacy', 'drugstore'],
      'cat-recreation-movies': ['netflix', 'movie', 'movies', 'cinema'],
      'cat-salary': ['salary', 'paycheck'],
      'cat-food-snacks': ['ice cream', 'snack', 'snacks', 'candy', 'chocolate'],
    },
    reserved: ['once'],
    dollarSign: { typed: 'family', speech: 'family' },
  },

  pt: {
    numbers: {
      zero: 0, um: 1, uma: 1, dois: 2, duas: 2, três: 3, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7,
      oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15,
      dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40,
      cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100,
    },
    numberJoiners: ['e'],
    articles: ['um', 'uma'],
    today: ['hoje'],
    yesterday: ['ontem'],
    dayBeforeYesterday: ['anteontem'],
    weekdays: { domingo: 0, segunda: 1, terça: 2, terca: 2, quarta: 3, quinta: 4, sexta: 5, sábado: 6, sabado: 6 },
    lastWeekday: [`\\b${W}\\s+passad[ao]\\b`, `\\búltim[ao]\\s+${W}\\b`],
    months: {
      janeiro: 0, fevereiro: 1, março: 2, marco: 2, abril: 3, maio: 4, junho: 5, julho: 6, agosto: 7,
      setembro: 8, outubro: 9, novembro: 10, dezembro: 11,
    },
    dateStyle: 'dayDeMonth',
    incomeTriggers: ['recebi', 'salário', 'salario', 'depósito', 'deposito'],
    merchantConnectors: ['no', 'na'],
    edgeFillers: ['de', 'em', 'no', 'na'],
    categoryKeywords: {
      'cat-food-groceries': ['mercado', 'supermercado', 'feira'],
      'cat-food-dining': ['restaurante', 'almoço', 'almoco', 'jantar'],
      'cat-food-coffee': ['café', 'cafe', 'cafezinho'],
      'cat-transport-rideshare': ['uber', 'corrida', 'táxi', 'taxi', '99'],
      'cat-transport-fuel': ['gasolina', 'combustível', 'combustivel', 'etanol'],
      'cat-transport-transit': ['ônibus', 'onibus', 'metrô', 'metro'],
      'cat-transport-parking': ['estacionamento'],
      'cat-health-pharmacy': ['farmácia', 'farmacia', 'remédio', 'remedio'],
      'cat-recreation-movies': ['cinema', 'netflix'],
      'cat-salary': ['salário', 'salario'],
      'cat-food-snacks': ['sorvete', 'picolé', 'picole', 'lanche', 'lanchinho', 'chocolate', 'açaí', 'acai', 'pastel', 'salgado', 'coxinha'],
    },
    reserved: ['dos', 'des'],
    dollarSign: { typed: 'family', speech: 'USD' },
  },

  es: {
    numbers: {
      cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8,
      nueve: 9, diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciséis: 16,
      dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiún: 21,
      veintidós: 22, veintidos: 22, veintitrés: 23, veintitres: 23, veinticuatro: 24, veinticinco: 25,
      veintiséis: 26, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30,
      cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90, cien: 100,
    },
    numberJoiners: ['y'],
    articles: ['un', 'uno', 'una'],
    today: ['hoy'],
    yesterday: ['ayer'],
    dayBeforeYesterday: ['anteayer', 'antier', 'antes de ayer'],
    weekdays: {
      domingo: 0, lunes: 1, martes: 2, miércoles: 3, miercoles: 3, jueves: 4, viernes: 5, sábado: 6, sabado: 6,
    },
    lastWeekday: [`\\b${W}\\s+pasado\\b`, `\\bpasado\\s+${W}\\b`],
    months: {
      enero: 0, febrero: 1, marzo: 2, abril: 3, mayo: 4, junio: 5, julio: 6, agosto: 7, septiembre: 8,
      setiembre: 8, octubre: 9, noviembre: 10, diciembre: 11,
    },
    dateStyle: 'dayDeMonth',
    incomeTriggers: ['recibí', 'recibi', 'cobré', 'sueldo', 'nómina', 'nomina', 'me pagaron', 'ingreso'],
    merchantConnectors: ['en'],
    edgeFillers: ['de', 'en', 'el', 'la', 'del', 'al', 'por'],
    categoryKeywords: {
      'cat-food-groceries': ['supermercado', 'súper', 'super', 'mercado'],
      'cat-food-dining': ['restaurante', 'almuerzo', 'cena', 'desayuno'],
      'cat-food-coffee': ['café', 'cafe'],
      'cat-transport-rideshare': ['uber', 'taxi', 'didi', 'cabify'],
      'cat-transport-fuel': ['gasolina', 'nafta', 'combustible'],
      'cat-transport-transit': ['autobús', 'autobus', 'metro', 'colectivo'],
      'cat-transport-parking': ['estacionamiento', 'aparcamiento', 'parking'],
      'cat-health-pharmacy': ['farmacia'],
      'cat-recreation-movies': ['cine', 'netflix'],
      'cat-salary': ['sueldo', 'salario', 'nómina', 'nomina'],
      'cat-food-snacks': ['helado', 'paleta', 'botana', 'botanas', 'golosinas', 'chocolate', 'snack'],
    },
    reserved: ['no'],
    dollarSign: { typed: 'none', speech: 'none' },
  },

  fr: {
    numbers: {
      zéro: 0, zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8,
      neuf: 9, dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16, vingt: 20,
      vingts: 20, trente: 30, quarante: 40, cinquante: 50, soixante: 60, septante: 70, huitante: 80,
      octante: 80, nonante: 90, cent: 100,
    },
    numberJoiners: ['et'],
    articles: ['un', 'une'],
    today: ['aujourd’hui', "aujourd'hui"],
    yesterday: ['hier'],
    dayBeforeYesterday: ['avant-hier', 'avant hier'],
    weekdays: { dimanche: 0, lundi: 1, mardi: 2, mercredi: 3, jeudi: 4, vendredi: 5, samedi: 6 },
    lastWeekday: [`\\b${W}\\s+dernier\\b`],
    months: {
      janvier: 0, janv: 0, février: 1, fevrier: 1, févr: 1, mars: 2, avril: 3, avr: 3, mai: 4, juin: 5,
      juillet: 6, juil: 6, août: 7, aout: 7, septembre: 8, octobre: 9, novembre: 10, décembre: 11,
      decembre: 11, déc: 11,
    },
    dateStyle: 'dayMonth',
    incomeTriggers: ['reçu', 'salaire', 'paie', 'paye', 'dépôt', 'revenu'],
    merchantConnectors: ['chez', 'au'],
    edgeFillers: ['à', 'au', 'le', 'la', 'chez', 'du', 'de', 'pour'],
    categoryKeywords: {
      'cat-food-groceries': ['épicerie', 'epicerie', 'courses', 'supermarché', 'supermarche'],
      'cat-food-dining': ['restaurant', 'resto', 'déjeuner', 'dîner', 'souper'],
      'cat-food-coffee': ['café', 'cafe'],
      'cat-transport-rideshare': ['uber', 'taxi'],
      'cat-transport-fuel': ['essence', 'carburant'],
      'cat-transport-transit': ['métro', 'metro', 'bus'],
      'cat-transport-parking': ['stationnement', 'parking'],
      'cat-health-pharmacy': ['pharmacie'],
      'cat-recreation-movies': ['cinéma', 'cinema', 'netflix'],
      'cat-salary': ['salaire', 'paie'],
      'cat-food-snacks': ['glace', 'crème glacée', 'creme glacee', 'grignotines', 'bonbons', 'chocolat', 'collation'],
    },
    reserved: ['sept'],
    dollarSign: { typed: 'family', speech: 'family' },
  },

  // docs/76 step 2. Speech recognizers write amounts as digits ("1500円",
  // "3万円"), so `numerals` matters most for the mixed 万/千 forms.
  ja: {
    numbers: {},
    numberJoiners: [],
    articles: [],
    today: ['今日', 'きょう', '本日'],
    yesterday: ['昨日', 'きのう'],
    // Checked before `yesterday`, which they contain.
    dayBeforeYesterday: ['一昨日', 'おととい', 'おとつい'],
    weekdays: { 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6, 日: 0 },
    lastWeekday: ['(月|火|水|木|金|土|日)曜'],
    previousWeekWeekday: ['先週の?(月|火|水|木|金|土|日)曜'],
    months: {},
    dateStyle: 'cjk',
    incomeTriggers: ['給料', '給与', '収入', '入金', 'ボーナス', '賞与', '売上'],
    merchantConnectors: [],
    edgeFillers: [],
    categoryKeywords: {
      'cat-food-groceries': ['スーパー', '食料品', '食材', '買い出し'],
      'cat-food-dining': ['ランチ', '昼ごはん', '昼食', '夕食', '晩ごはん', '朝ごはん', '外食', 'レストラン', '定食', 'ラーメン', '寿司', '焼肉', '弁当'],
      'cat-food-coffee': ['コーヒー', 'カフェ', 'スタバ', '珈琲', 'アイスコーヒー', 'カフェラテ'],
      'cat-food-snacks': ['おやつ', 'お菓子', 'アイス', 'スイーツ', 'ケーキ'],
      'cat-food-alcohol': ['お酒', 'ビール', '居酒屋', '飲み会', 'ワイン'],
      'cat-transport-rideshare': ['タクシー', 'ウーバー'],
      'cat-transport-fuel': ['ガソリン', '給油'],
      'cat-transport-transit': ['電車', '地下鉄', '新幹線', '交通費', 'バス代'],
      'cat-transport-parking': ['駐車場', '駐車'],
      'cat-health-pharmacy': ['薬局', 'ドラッグストア'],
      'cat-health-medical': ['病院', '診察'],
      'cat-recreation-movies': ['映画', 'ネットフリックス'],
      'cat-shopping-clothing': ['洋服', 'ユニクロ'],
      'cat-housing-rent': ['家賃'],
      'cat-housing-electricity': ['電気代'],
      'cat-housing-water': ['水道代'],
      'cat-housing-heat': ['ガス代'],
      'cat-housing-phone': ['携帯代', 'スマホ代', '携帯料金'],
      'cat-personal-subscriptions': ['サブスク'],
      'cat-salary': ['給料', '給与'],
    },
    reserved: [],
    dollarSign: { typed: 'family', speech: 'family' },
    noSpaces: true,
    numerals: {
      digits: { 〇: 0, 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 },
      small: { 十: 10, 百: 100, 千: 1000 },
      large: { 万: 10_000, 億: 100_000_000 },
    },
    amountCounters: ['円'],
    merchantAfter: ['で'],
    edgeParticles: ['から', 'まで', 'で', 'に', 'を', 'の', 'は', 'が', 'と', 'へ', 'も', '、', '。'],
  },
};

export function packFor(language: string | undefined): PackId | null {
  const base = language?.toLowerCase().split('-')[0];
  return base === 'en' || base === 'pt' || base === 'es' || base === 'fr' || base === 'ja' ? base : null;
}

// Packs in priority order: the input language first, then the rest.
export function orderedPacks(language: string | undefined): { id: PackId; pack: LanguagePack }[] {
  const first = packFor(language);
  const ids: PackId[] = ['en', 'pt', 'es', 'fr', 'ja'];
  const order = first ? [first, ...ids.filter((id) => id !== first)] : ids;
  return order.map((id) => ({ id, pack: PACKS[id] }));
}

// One merged list per vocabulary kind. A word another language claims
// stays out when the input language reserves it, unless the input
// language itself lists it for that kind.
export function mergedWords(language: string | undefined, pick: (p: LanguagePack) => string[]): string[] {
  const ordered = orderedPacks(language);
  const reserved = packFor(language) ? new Set(ordered[0].pack.reserved) : new Set<string>();
  const own = new Set(pick(ordered[0].pack));
  const out: string[] = [];
  for (const { pack } of ordered) {
    for (const w of pick(pack)) {
      if (out.includes(w)) continue;
      if (reserved.has(w) && !own.has(w)) continue;
      out.push(w);
    }
  }
  return out;
}

export function mergedMap(language: string | undefined, pick: (p: LanguagePack) => Record<string, number>): Record<string, number> {
  const ordered = orderedPacks(language);
  const reserved = packFor(language) ? new Set(ordered[0].pack.reserved) : new Set<string>();
  const own = pick(ordered[0].pack);
  const out: Record<string, number> = {};
  for (const { pack } of ordered) {
    for (const [w, v] of Object.entries(pick(pack))) {
      if (w in out) continue; // the higher-priority language's meaning wins
      if (reserved.has(w) && !(w in own)) continue;
      out[w] = v;
    }
  }
  return out;
}
