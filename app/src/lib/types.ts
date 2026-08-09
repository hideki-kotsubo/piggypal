// Mirrors db/schema.sql — kept in sync by hand until codegen exists.

export type AccountKind = 'checking' | 'credit' | 'cash' | 'savings';

export interface Account {
  id: string;
  institution: string | null;
  name: string;
  kind: AccountKind;
  currency: string;
  goalAmountCents: number | null;
  goalTargetDate: string | null;
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
  occurredOn: string; // ISO date
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
