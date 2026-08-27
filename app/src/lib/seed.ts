import type { Category, CategoryKeyword } from './types';

// A real starter taxonomy + parser vocabulary, shipped to every fresh
// install (signed-in or not) — not demo/placeholder data. Accounts,
// transactions, and budgets used to be seeded here too as fake UI-dev
// fixtures (Visa/Costco/Uber/...), but that meant every real new user's
// first launch silently mixed fictional financial data into their own
// store with no way to tell it apart. Removed outright — a real user's
// Home starts genuinely empty and they add their own first account.

// docs/14: a full starter taxonomy — 7 expense groups with 4-9 children
// each, English (2026-08-12 decision — the app's bilingual promise, docs/09,
// covers the UI chrome and AI parsing, not seed category names specifically).
// Housing and Utilities are merged into one group per that same decision.
// Ids stay fixed slugs deliberately (docs/24 D112) — household merge relies
// on two installs' identical starter taxonomy sharing the same id so it
// collapses into one row instead of duplicating. Safe across unrelated
// users too: categories' primary key is composite (user_id, id) (docs/46
// D162), so the same slug for two different people is two distinct rows,
// never a collision. Don't "fix" these to generated ids.
export const seedCategories: Omit<Category, 'updatedAt'>[] = [
  { id: 'cat-food', name: 'Food & Groceries', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-food-groceries', name: 'Groceries', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-dining', name: 'Dining Out', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-coffee', name: 'Coffee', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-snacks', name: 'Snacks', kind: 'expense', parentId: 'cat-food', archived: false },
  { id: 'cat-food-alcohol', name: 'Alcohol & Bars', kind: 'expense', parentId: 'cat-food', archived: false },

  { id: 'cat-housing', name: 'Housing & Utilities', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-housing-rent', name: 'Rent/Mortgage', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-proptax', name: 'Property Tax', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-insurance', name: 'Home Insurance', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-maintenance', name: 'Maintenance & Repairs', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-electricity', name: 'Electricity', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-water', name: 'Water', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-heat', name: 'Heating/Gas', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-internet', name: 'Internet', kind: 'expense', parentId: 'cat-housing', archived: false },
  { id: 'cat-housing-phone', name: 'Phone', kind: 'expense', parentId: 'cat-housing', archived: false },

  { id: 'cat-health', name: 'Health & Personal Care', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-health-medical', name: 'Medical', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-dental', name: 'Dental', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-pharmacy', name: 'Pharmacy', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-vision', name: 'Vision', kind: 'expense', parentId: 'cat-health', archived: false },
  { id: 'cat-health-fitness', name: 'Fitness/Gym', kind: 'expense', parentId: 'cat-health', archived: false },

  { id: 'cat-transport', name: 'Transportation', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-transport-car', name: 'Car Costs', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-fuel', name: 'Fuel', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-parking', name: 'Parking', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-transit', name: 'Transit', kind: 'expense', parentId: 'cat-transport', archived: false },
  { id: 'cat-transport-rideshare', name: 'Rideshare', kind: 'expense', parentId: 'cat-transport', archived: false },

  { id: 'cat-recreation', name: 'Recreation & Entertainment', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-recreation-movies', name: 'Movies & Streaming', kind: 'expense', parentId: 'cat-recreation', archived: false },
  { id: 'cat-recreation-hobbies', name: 'Hobbies', kind: 'expense', parentId: 'cat-recreation', archived: false },
  { id: 'cat-recreation-travel', name: 'Travel', kind: 'expense', parentId: 'cat-recreation', archived: false },
  { id: 'cat-recreation-kids', name: 'Kids Activities', kind: 'expense', parentId: 'cat-recreation', archived: false },
  // Spectator/admission spend — ballgames, pool/museum/concert tickets —
  // distinct from screen entertainment (Movies & Streaming) and hands-on
  // participation (Hobbies).
  { id: 'cat-recreation-events', name: 'Events & Tickets', kind: 'expense', parentId: 'cat-recreation', archived: false },

  { id: 'cat-shopping', name: 'Shopping', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-shopping-clothing', name: 'Clothing', kind: 'expense', parentId: 'cat-shopping', archived: false },
  { id: 'cat-shopping-electronics', name: 'Electronics', kind: 'expense', parentId: 'cat-shopping', archived: false },
  { id: 'cat-shopping-household', name: 'Household Items', kind: 'expense', parentId: 'cat-shopping', archived: false },

  { id: 'cat-personal', name: 'Personal & Family', kind: 'expense', parentId: null, archived: false },
  { id: 'cat-personal-subscriptions', name: 'Subscriptions', kind: 'expense', parentId: 'cat-personal', archived: false },
  { id: 'cat-personal-gifts', name: 'Gifts & Donations', kind: 'expense', parentId: 'cat-personal', archived: false },
  { id: 'cat-personal-education', name: 'Education', kind: 'expense', parentId: 'cat-personal', archived: false },
  { id: 'cat-personal-childcare', name: 'Childcare', kind: 'expense', parentId: 'cat-personal', archived: false },

  { id: 'cat-salary', name: 'Salary', kind: 'income', parentId: null, archived: false },
];

// docs/16: a small bilingual starter vocabulary for the Tier 1 rule-based
// parser to match against, on top of each category's own bare name —
// without this the parser has nothing to work with on a fresh account.
// Not exhaustive (same "starter, not full taxonomy" spirit as
// seedCategories) — real vocabulary is meant to grow from the docs/04
// learning loop, which this pass doesn't implement yet.
let kwId = 0;
function kw(categoryId: string, keyword: string): CategoryKeyword {
  kwId += 1;
  return { id: `ckw-${kwId}`, categoryId, keyword, hits: 1 };
}
export const seedCategoryKeywords: CategoryKeyword[] = [
  ...['mercado', 'grocery', 'groceries', 'supermercado', 'supermarket'].map((k) => kw('cat-food-groceries', k)),
  ...['restaurante', 'restaurant', 'jantar', 'almoço', 'lunch', 'dinner'].map((k) => kw('cat-food-dining', k)),
  ...['café', 'cafe', 'coffee', 'cafezinho'].map((k) => kw('cat-food-coffee', k)),
  ...['uber', 'corrida', 'taxi', '99'].map((k) => kw('cat-transport-rideshare', k)),
  ...['gasolina', 'gas', 'combustível', 'combustivel'].map((k) => kw('cat-transport-fuel', k)),
  ...['salário', 'salario', 'salary', 'recebi', 'pagamento', 'paycheck'].map((k) => kw('cat-salary', k)),
];
