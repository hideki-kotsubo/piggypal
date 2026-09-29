import { describe, expect, it } from 'vitest';
import { isUntouchedSeedAccount, referencedAccountIds, seedAccounts } from './seed';

describe('seedAccounts', () => {
  it('seeds only Cash and Checking, with no institution', () => {
    expect(seedAccounts).toEqual([
      { institution: null, name: 'Cash', kind: 'cash' },
      { institution: null, name: 'Checking', kind: 'checking' },
    ]);
  });
});

describe('referencedAccountIds', () => {
  it('collects ids from transactions and splits, skipping null', () => {
    const ids = referencedAccountIds([{ accountId: 'a-1' }, { accountId: null }], [{ accountId: 'a-2' }]);
    expect([...ids].sort()).toEqual(['a-1', 'a-2']);
  });
});

describe('isUntouchedSeedAccount', () => {
  const cash = { id: 'a-1', institution: null, name: 'Cash', kind: 'cash' as const };

  it('is true for an unused, unedited starter account', () => {
    expect(isUntouchedSeedAccount(cash, new Set())).toBe(true);
  });

  it('is false once a transaction references it', () => {
    expect(isUntouchedSeedAccount(cash, new Set(['a-1']))).toBe(false);
  });

  it('is false once renamed, re-kinded, or given an institution', () => {
    expect(isUntouchedSeedAccount({ ...cash, name: 'Wallet' }, new Set())).toBe(false);
    expect(isUntouchedSeedAccount({ ...cash, kind: 'savings' }, new Set())).toBe(false);
    expect(isUntouchedSeedAccount({ ...cash, institution: 'TD' }, new Set())).toBe(false);
  });

  it('is false for a user-created account that is not a starter', () => {
    expect(isUntouchedSeedAccount({ id: 'a-2', institution: 'TD', name: 'Checking', kind: 'checking' }, new Set())).toBe(false);
  });
});
