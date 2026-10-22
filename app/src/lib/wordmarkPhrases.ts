// docs/00-backlog "Dynamic Home header wordmark" — the app-bar's
// `.wordmark` (App.tsx) rotates through these instead of always showing
// "piggypal". HOUSEHOLD_PHRASES assume a second person is actually
// logging transactions alongside you (docs/38's payer/owner UI, docs/48's
// household profiles) — only mixed in once hasHousehold() is true, so a
// solo user never sees "whose turn was it anyway?" with no one to mean.
// docs/73: one pool per language, written natively rather than translated
// line by line (taglines don't survive literal translation), so pool
// sizes differ. Regional variants share their base language's pool.

const GENERAL_EN: string[] = [
  // Classic idioms & conversational lines
  'Put it on my tab',
  'Keep a running tally',
  'Settle up later',
  'Chalk it up',
  'Just between us',

  // Quiet, offline & private
  'Private household ledger',
  'Your private slate',

  // Effortless & spoken (voice-first)
  'Murmur and move on',
  'Speak it into the ledger',
  'Just say the word',
  'One whisper at a time',
  'Said, logged, done',

  // Tactile & calm balance
  'Smooth stones in the pouch',
  'Inflows, outflows, balance',
  'Keeping things even',
  'A quiet tally of daily life',

  // Ultra-short & punchy
  'Just the tab',
  'On the slate',
  'In and out',
  'Spoken and saved',
  'Simple running tally',
  'Pluses and minuses',
  'Purely yours',
  'Speak to log',
  'The honest count',
  'Marked and settled',
  'Pocket ledger',
  'Daily balance',
  'Said and done',
  'Quiet tally',

  // Calm & zen micro-mantras
  'Inhale the earnings, exhale the costs',
  'A quiet corner for your coin',
  'No rush, just balance',
  'Money moving like gentle water',
  'Stones gathered along the way',
  "Today's rhythm, softly noted",
  'Simple days, settled numbers',
  'Peace of mind in your pocket',
  'Let the noise fade, keep the tally',
  'One small entry at a time',
  'A still pond reflects true numbers',
  'Light on the screen, light on the mind',
  'Resting safely in the pouch',
];

// Playful & witty — shared household / couples. Only shown once
// hasHousehold() confirms there's actually someone else to mean.
const HOUSEHOLD_EN: string[] = [
  'Two under one roof',
  'Who bought dinner?',
  'Not arguing, just logging',
  'Whose turn was it anyway?',
  "Love is patient, groceries aren't",
  'Added to the matrimonial debt',
  'Your turn to pick up the tab',
  'Keeping love and coffee even',
  'For the domestic peace',
  'What did we just buy?',
  'Proof that I bought the milk',
  'Fair shares under one roof',
  'Less math, more dinner',
  'You paid lunch, I got groceries',
  'Two lives, one running total',
  "Let's pretend it was on sale",
];

const GENERAL_PT: string[] = [
  'Pendura na conta',
  'Anota aí',
  'Na ponta do lápis',
  'Tim-tim por tim-tim',
  'Só entre nós',
  'Seu caderninho particular',
  'Fala que eu anoto',
  'Falou, anotou, pronto',
  'Entrou, saiu, fechou',
  'Sem planilha, sem drama',
  'Tudo nos conformes',
  'Um gasto de cada vez',
  'Contas em dia, cabeça leve',
  'Calma, tá anotado',
  'Caderninho de bolso',
  'Saldo do dia',
  'Mais e menos',
  'Só seu',
  'Falou, salvou',
  'A conta honesta',
  'Grão em grão',
  'Devagar e sempre',
  'Dinheiro correndo feito água mansa',
  'Paz no bolso',
  'Pé-de-meia em dia',
];

const HOUSEHOLD_PT: string[] = [
  'Dois sob o mesmo teto',
  'Quem pagou o jantar?',
  'Não é briga, é registro',
  'De quem era a vez mesmo?',
  'O amor é paciente, o mercado não',
  'Sua vez de pagar a conta',
  'Amor e cafezinho na medida',
  'Pela paz do lar',
  'O que foi que a gente comprou?',
  'Prova de que eu comprei o leite',
  'Menos conta, mais janta',
  'Você pagou o almoço, eu o mercado',
  'Duas vidas, um saldo só',
  'Finge que tava em promoção',
];

const GENERAL_ES: string[] = [
  'Apúntalo a mi cuenta',
  'Cuentas claras',
  'Dilo y listo',
  'Dicho, anotado, hecho',
  'Entre nosotros',
  'Tu libreta privada',
  'Entra, sale, cuadra',
  'Sin hojas de cálculo, sin drama',
  'Un gasto a la vez',
  'La cuenta honesta',
  'Saldo del día',
  'Más y menos',
  'Solo tuyo',
  'Hablado y guardado',
  'Tu libreta de bolsillo',
  'Paz en el bolsillo',
  'Sin prisa, en equilibrio',
  'El dinero fluye como agua mansa',
  'Cada moneda en su lugar',
  'Poco a poco',
  'Gota a gota',
  'Todo en orden',
  'Anotado y cuadrado',
];

const HOUSEHOLD_ES: string[] = [
  'Dos bajo el mismo techo',
  '¿Quién pagó la cena?',
  'No discutimos, anotamos',
  '¿A quién le tocaba?',
  'El amor es paciente, el súper no',
  'Te toca pagar a ti',
  'Amor y café, a partes iguales',
  'Por la paz del hogar',
  '¿Qué acabamos de comprar?',
  'Prueba de que compré la leche',
  'Menos cuentas, más cena',
  'Tú pagaste la comida, yo el súper',
  'Dos vidas, un solo total',
  'Hagamos como que estaba en oferta',
  'Cuentas claras, amistades largas',
];

const GENERAL_FR: string[] = [
  'Mets-le sur mon ardoise',
  'Noté sur l’ardoise',
  'On fera les comptes plus tard',
  'Juste entre nous',
  'Votre carnet privé',
  'Dites-le, c’est noté',
  'Dit, noté, réglé',
  'Entrées, sorties, équilibre',
  'Rien qu’à vous',
  'Le compte juste',
  'Petit carnet de poche',
  'Solde du jour',
  'Plus et moins',
  'Dit et enregistré',
  'Sans tableur, sans drame',
  'Une dépense à la fois',
  'L’argent coule comme une eau calme',
  'L’esprit tranquille en poche',
  'Pas de hâte, juste l’équilibre',
  'Sou après sou',
  'Tout est en ordre',
  'Petit à petit',
];

const HOUSEHOLD_FR: string[] = [
  'Deux sous le même toit',
  'Qui a payé le resto ?',
  'On ne se dispute pas, on note',
  'C’était à qui le tour ?',
  'L’amour est patient, les courses non',
  'À ton tour de régler l’ardoise',
  'L’amour et le café à parts égales',
  'Pour la paix du foyer',
  'Qu’est-ce qu’on vient d’acheter ?',
  'La preuve que j’ai acheté le lait',
  'Moins de calculs, plus de bons repas',
  'Deux vies, un seul total',
  'Disons que c’était en solde',
  'Les bons comptes font les bons amis',
];

// docs/76 — Japanese, Korean, Chinese.
const GENERAL_JA: string[] = [
  'つけといて',
  'ちりも積もれば山となる',
  'さっと記録',
  '言うだけ家計簿',
  '今日の収支',
  'あなただけの帳簿',
  '静かな家計簿',
  'ひと言で記録',
  '話して、記録して、おしまい',
  '小さな記録、確かな家計',
  'お財布にやさしく',
  'プラスとマイナス',
  'ポケットの帳面',
  '収支すっきり',
  'お金の流れをそっと',
  '一円単位で',
  'のんびり、きっちり',
  '今日もおつかれさま',
  'ゆるく、まめに',
];

const HOUSEHOLD_JA: string[] = [
  'ひとつ屋根の下',
  '夕飯、誰が払った？',
  'けんかじゃなくて記録',
  '今回はどっちの番？',
  '牛乳を買った証拠',
  'ふたりの暮らし、ひとつの合計',
  'ランチはあなた、スーパーはわたし',
  '家庭円満のために',
  '今、何買ったっけ？',
  'セールだったことにしよう',
  '割り勘も、すっきり',
];

const GENERAL_KO: string[] = [
  '외상으로 달아 줘요',
  '티끌 모아 태산',
  '말만 하면 기록 끝',
  '오늘의 수입과 지출',
  '나만의 가계부',
  '조용한 가계부',
  '말하고, 기록하고, 끝',
  '한 푼도 빠짐없이',
  '주머니 속 장부',
  '더하기 빼기',
  '정직한 계산',
  '차곡차곡',
  '천천히, 꼼꼼히',
  '지갑에 평화를',
  '하루하루 가볍게',
  '오늘도 수고했어요',
  '돈의 흐름을 살짝',
  '기록은 짧게, 마음은 가볍게',
];

const HOUSEHOLD_KO: string[] = [
  '한 지붕 아래 두 사람',
  '저녁은 누가 샀지?',
  '싸움 말고 기록',
  '이번엔 누구 차례였지?',
  '우유 산 증거',
  '두 사람, 하나의 합계',
  '점심은 네가, 장보기는 내가',
  '집안의 평화를 위해',
  '방금 뭐 샀더라?',
  '세일이었던 걸로 하자',
  '더치페이도 깔끔하게',
];

const GENERAL_ZH_HANS: string[] = [
  '先记账上',
  '积少成多',
  '说一句就记好',
  '今日收支',
  '你的私人账本',
  '安静的小账本',
  '说完，记好，搞定',
  '一分一毛都清楚',
  '口袋里的账本',
  '有进有出',
  '老实的账',
  '慢慢来，记清楚',
  '钱包里的平静',
  '轻轻松松过日子',
  '今天也辛苦了',
  '钱的流向，悄悄记下',
  '记账不费劲',
  '聚沙成塔',
];

const HOUSEHOLD_ZH_HANS: string[] = [
  '同一屋檐下',
  '晚饭谁请的？',
  '不吵架，只记账',
  '这次轮到谁了？',
  '我买过牛奶的证据',
  '两个人，一个总数',
  '午饭你请，菜我买',
  '为了家庭和睦',
  '我们刚买了啥？',
  '就当它在打折吧',
  'AA 也清清楚楚',
  '亲兄弟，明算账',
];

// Converted from the Simplified pool (OpenCC, Taiwan phrases).
const GENERAL_ZH_HANT: string[] = [
  '先記帳上',
  '積少成多',
  '說一句就記好',
  '今日收支',
  '你的私人帳本',
  '安靜的小帳本',
  '說完，記好，搞定',
  '一分一毛都清楚',
  '口袋裡的帳本',
  '有進有出',
  '老實的帳',
  '慢慢來，記清楚',
  '錢包裡的平靜',
  '輕輕鬆鬆過日子',
  '今天也辛苦了',
  '錢的流向，悄悄記下',
  '記帳不費勁',
  '聚沙成塔',
];

const HOUSEHOLD_ZH_HANT: string[] = [
  '同一屋簷下',
  '晚飯誰請的？',
  '不吵架，只記帳',
  '這次輪到誰了？',
  '我買過牛奶的證據',
  '兩個人，一個總數',
  '午飯你請，菜我買',
  '為了家庭和睦',
  '我們剛買了啥？',
  '就當它在打折吧',
  'AA 也清清楚楚',
  '親兄弟，明算帳',
];


const POOLS: Record<string, { general: string[]; household: string[] }> = {
  en: { general: GENERAL_EN, household: HOUSEHOLD_EN },
  pt: { general: GENERAL_PT, household: HOUSEHOLD_PT },
  es: { general: GENERAL_ES, household: HOUSEHOLD_ES },
  fr: { general: GENERAL_FR, household: HOUSEHOLD_FR },
  ja: { general: GENERAL_JA, household: HOUSEHOLD_JA },
  ko: { general: GENERAL_KO, household: HOUSEHOLD_KO },
  'zh-Hans': { general: GENERAL_ZH_HANS, household: HOUSEHOLD_ZH_HANS },
  'zh-Hant': { general: GENERAL_ZH_HANT, household: HOUSEHOLD_ZH_HANT },
};

export function wordmarkPool(language: string, hasHousehold: boolean): string[] {
  // Full tag first (zh-Hant has its own pool), then the base language.
  const pools = POOLS[language] ?? POOLS[language.split('-')[0]] ?? POOLS.en;
  return hasHousehold ? [...pools.general, ...pools.household] : pools.general;
}

export function pickWordmarkPhrase(language: string, hasHousehold: boolean): string {
  const pool = wordmarkPool(language, hasHousehold);
  return pool[Math.floor(Math.random() * pool.length)];
}
