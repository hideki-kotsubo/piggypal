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

const POOLS: Record<string, { general: string[]; household: string[] }> = {
  en: { general: GENERAL_EN, household: HOUSEHOLD_EN },
  pt: { general: GENERAL_PT, household: HOUSEHOLD_PT },
  es: { general: GENERAL_ES, household: HOUSEHOLD_ES },
  fr: { general: GENERAL_FR, household: HOUSEHOLD_FR },
};

export function wordmarkPool(language: string, hasHousehold: boolean): string[] {
  const pools = POOLS[language.split('-')[0]] ?? POOLS.en;
  return hasHousehold ? [...pools.general, ...pools.household] : pools.general;
}

export function pickWordmarkPhrase(language: string, hasHousehold: boolean): string {
  const pool = wordmarkPool(language, hasHousehold);
  return pool[Math.floor(Math.random() * pool.length)];
}
