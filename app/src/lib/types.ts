// Mirrors db/schema.sql — kept in sync by hand until codegen exists.

export type AccountKind = 'checking' | 'credit' | 'cash' | 'savings';

// No currency, no savings goal — an account is a payment-method identity
// only. Currency lives on the transaction (see below), chosen at entry
// time alongside the account, independently. Goals are tracked per
// category (see Budget), not per account — docs/11 is superseded.
export interface Account {
  id: string;
  institution: string | null; // "TD", "Itaú", "Wise" — grouping/display only, see docs/12 D60/D61
  name: string;
  kind: AccountKind;
  archived: boolean;
  // Whose payment instrument this is — docs/24 D110. Real even in
  // today's single-device local-only mode (getLocalUserId()); only shown
  // in the UI once a household has 2+ members, but every account needs a
  // value from day one so there's nothing to backfill later.
  ownerUserId: string;
}

// parentId nullable, exactly 2 levels deep — enforced app-side only (a
// category that already has a parent is never itself offered as a parent)
// — see docs/14 D70.
export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  parentId: string | null;
  archived: boolean;
}

export type TransactionSource = 'manual' | 'ai' | 'import';

export interface Transaction {
  id: string;
  accountId: string;
  categoryId: string | null;
  amountCents: number; // negative = expense, positive = income
  currency: string;
  occurredAt: string; // local date+time, "YYYY-MM-DDTHH:MM:SS", no timezone
  note: string | null;
  merchant: string | null; // "Costco", "Uber" — display/grouping only, see docs/15
  source: TransactionSource;
  aiRaw: string | null;
  deletedAt: string | null;
  // docs/24 D110 — deliberately two different facts, not one:
  // paidByUserId is whose money this was (mutable, editable any time);
  // createdByUserId is who logged the row (set once at insert, never
  // patched after). Both real from day one, same reasoning as
  // Account.ownerUserId above.
  paidByUserId: string;
  createdByUserId: string;
}

export interface Budget {
  id: string;
  categoryId: string;
  month: string; // first of month, ISO date
  currency: string;
  amountCents: number;
}

// docs/16: vocabulary the Tier 1 rule-based parser matches against, on top
// of each category's own bare name. Seeded with a small bilingual starter
// set; the docs/04 learning loop (writing new keywords from Inbox
// corrections) is explicitly deferred — this pass only seeds and reads.
export interface CategoryKeyword {
  id: string;
  categoryId: string;
  keyword: string;
  hits: number;
}

// docs/25 D119 / docs/24: what one side of a P2P sync sends the other —
// its whole local dataset, applying docs/24's merge rules on receipt
// (store.applyPeerDataset). category_keywords deliberately excluded: the
// docs/04 learning loop that would ever change them post-seed isn't built
// (docs/16 D91), so there's nothing there worth the extra merge-rule
// surface yet.
export interface PeerDataset {
  localUserId: string;
  categories: Category[];
  accounts: Account[];
  transactions: Transaction[];
  budgets: Budget[];
}

export interface MergeSummary {
  categoriesAdded: number;
  accountsAdded: number;
  transactionsAdded: number;
  budgetsAdded: number;
  budgetsUpdated: number;
}
