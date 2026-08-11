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
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
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
  source: TransactionSource;
  aiRaw: string | null;
  deletedAt: string | null;
}

export interface Budget {
  id: string;
  categoryId: string;
  month: string; // first of month, ISO date
  currency: string;
  amountCents: number;
}
