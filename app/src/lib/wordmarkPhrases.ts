// docs/00-backlog "Dynamic Home header wordmark" — the app-bar's
// `.wordmark` (App.tsx) rotates through these instead of always showing
// "piggypal". HOUSEHOLD_PHRASES assume a second person is actually
// logging transactions alongside you (docs/38's payer/owner UI, docs/48's
// household profiles) — only mixed in once hasHousehold() is true, so a
// solo user never sees "whose turn was it anyway?" with no one to mean.
// English-only for now: a deliberate, flagged gap against docs/09 D31's
// full-bilingual-UI decision, not an oversight — pending a pt-BR pass.

export const GENERAL_PHRASES: string[] = [
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
export const HOUSEHOLD_PHRASES: string[] = [
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

export function pickWordmarkPhrase(hasHousehold: boolean): string {
  const pool = hasHousehold ? [...GENERAL_PHRASES, ...HOUSEHOLD_PHRASES] : GENERAL_PHRASES;
  return pool[Math.floor(Math.random() * pool.length)];
}
