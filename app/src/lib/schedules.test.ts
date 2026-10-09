import { describe, expect, it } from 'vitest';
import {
  committedForMonth,
  describeCadence,
  dueOccurrences,
  installmentAmount,
  nextOpenOccurrence,
  occurrenceNote,
  occurrenceTransactionId,
  postedKeys,
  projectOccurrences,
  splitStartIndex,
  upcomingOccurrences,
  uuidv5,
} from './schedules';
import type { ScheduledPayment } from './types';

function rule(overrides: Partial<ScheduledPayment>): ScheduledPayment {
  return {
    id: 'r-1',
    name: 'Rent',
    accountId: 'a-1',
    categoryId: 'cat-housing',
    amountCents: -200000,
    amountMode: 'fixed',
    currency: 'CAD',
    merchant: null,
    note: null,
    paidByUserId: 'u-1',
    kind: 'recurring',
    freq: 'monthly',
    intervalCount: 1,
    anchorDate: '2026-01-01',
    occurrenceCount: null,
    endDate: null,
    startIndex: 1,
    autoPost: false,
    paused: false,
    archived: false,
    deletedAt: null,
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const dates = (r: ScheduledPayment, from: string, to: string) => projectOccurrences(r, from, to).map((o) => o.date);

describe('projectOccurrences', () => {
  it('projects monthly occurrences within the range', () => {
    expect(dates(rule({}), '2026-02-15', '2026-05-01')).toEqual(['2026-03-01', '2026-04-01', '2026-05-01']);
  });

  it('clamps day 31 to short months without drifting (D209)', () => {
    expect(dates(rule({ anchorDate: '2026-01-31' }), '2026-01-01', '2026-04-30')).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('handles leap years and yearly Feb 29', () => {
    expect(dates(rule({ anchorDate: '2028-02-29', freq: 'yearly' }), '2028-01-01', '2032-12-31')).toEqual([
      '2028-02-29',
      '2029-02-28',
      '2030-02-28',
      '2031-02-28',
      '2032-02-29',
    ]);
  });

  it('projects every N weeks across a month boundary', () => {
    expect(dates(rule({ freq: 'weekly', intervalCount: 2, anchorDate: '2026-10-23' }), '2026-10-01', '2026-11-30')).toEqual([
      '2026-10-23',
      '2026-11-06',
      '2026-11-20',
    ]);
  });

  it('stops at endDate (inclusive)', () => {
    expect(dates(rule({ endDate: '2026-03-01' }), '2026-01-01', '2026-12-31')).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
    ]);
  });

  it('stops after the installment count and numbers from startIndex', () => {
    const r = rule({ kind: 'installment', amountCents: -100000, occurrenceCount: 5, startIndex: 3 });
    const occ = projectOccurrences(r, '2000-01-01', '2099-01-01');
    expect(occ.map((o) => [o.date, o.number])).toEqual([
      ['2026-01-01', 3],
      ['2026-02-01', 4],
      ['2026-03-01', 5],
    ]);
  });

  it('returns nothing before the anchor', () => {
    expect(dates(rule({ anchorDate: '2027-01-01' }), '2026-01-01', '2026-12-31')).toEqual([]);
  });
});

describe('installmentAmount (D211)', () => {
  it('puts the remainder cents on the first installment', () => {
    expect([1, 2, 3].map((n) => installmentAmount(100000, 3, n))).toEqual([33334, 33333, 33333]);
  });

  it('preserves sign and always sums back to the total', () => {
    const parts = Array.from({ length: 7 }, (_, i) => installmentAmount(-99999, 7, i + 1));
    expect(parts.every((p) => p < 0)).toBe(true);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(-99999);
  });

  it('feeds per-occurrence amounts for installment rules', () => {
    const r = rule({ kind: 'installment', amountCents: -100000, occurrenceCount: 3 });
    expect(projectOccurrences(r, '2026-01-01', '2026-12-31').map((o) => o.amountCents)).toEqual([-33334, -33333, -33333]);
  });
});

describe('open / due / upcoming', () => {
  const posted = postedKeys([
    { scheduleId: 'r-1', occurrenceDate: '2026-09-01' },
    { scheduleId: 'r-1', occurrenceDate: '2026-08-01' }, // e.g. a skip: soft-deleted still counts
    { scheduleId: null, occurrenceDate: null },
  ]);

  it('keeps every unposted past occurrence due, with no lower bound', () => {
    const r = rule({ anchorDate: '2026-07-01' });
    expect(dueOccurrences([r], posted, '2026-10-08').map((o) => o.date)).toEqual(['2026-07-01', '2026-10-01']);
  });

  it('excludes soft-deleted rules (D217) from due and committed', () => {
    const deleted = rule({ deletedAt: '2026-10-09T00:00:00.000Z', anchorDate: '2026-07-01' });
    expect(dueOccurrences([deleted], posted, '2026-10-08')).toEqual([]);
    expect(committedForMonth([deleted], posted, '2026-10-01').size).toBe(0);
  });

  it('excludes paused and archived rules', () => {
    expect(dueOccurrences([rule({ paused: true }), rule({ id: 'r-2', archived: true })], posted, '2026-10-08')).toEqual([]);
  });

  it('lists upcoming strictly after today, sorted across rules', () => {
    const rent = rule({ anchorDate: '2026-07-01' });
    const gym = rule({ id: 'r-2', anchorDate: '2026-07-15', amountCents: -5000 });
    expect(upcomingOccurrences([rent, gym], posted, '2026-10-08', 30).map((o) => `${o.scheduleId}@${o.date}`)).toEqual([
      'r-2@2026-10-15',
      'r-1@2026-11-01',
    ]);
  });

  it('finds the next open occurrence, skipping posted ones', () => {
    expect(nextOpenOccurrence(rule({ anchorDate: '2026-07-01' }), posted, '2026-08-01')?.date).toBe('2026-10-01');
  });
});

describe('committedForMonth (D213)', () => {
  it('sums open expense occurrences per category and currency, never blending currencies', () => {
    const rent = rule({});
    const brl = rule({ id: 'r-2', currency: 'BRL', amountCents: -15000, freq: 'weekly', anchorDate: '2026-10-02' });
    const salary = rule({ id: 'r-3', amountCents: 500000, categoryId: 'cat-salary' });
    const posted = postedKeys([{ scheduleId: 'r-2', occurrenceDate: '2026-10-02' }]);
    const m = committedForMonth([rent, brl, salary], posted, '2026-10-01');
    expect(Object.fromEntries(m)).toEqual({ 'cat-housing:CAD': 200000, 'cat-housing:BRL': 60000 }); // 5 Fridays, 1 posted
  });
});

describe('splitStartIndex (D210)', () => {
  it('continues the installment numbering on the split-off rule', () => {
    const r = rule({ kind: 'installment', occurrenceCount: 10, startIndex: 2 });
    expect(splitStartIndex(r, '2026-04-01')).toBe(5);
  });
});

describe('labels', () => {
  it('suffixes installments with n/N', () => {
    expect(occurrenceNote(rule({ name: 'TV', kind: 'installment', occurrenceCount: 10 }), { number: 3 })).toBe('TV (3/10)');
    expect(occurrenceNote(rule({ note: 'Apartment' }), { number: 3 })).toBe('Apartment');
  });

  it('describes cadence', () => {
    expect(describeCadence(rule({}))).toBe('Monthly on the 1st');
    expect(describeCadence(rule({ anchorDate: '2026-01-31' }))).toBe('Monthly on the 31st (or last day)');
    expect(describeCadence(rule({ freq: 'weekly', intervalCount: 2, anchorDate: '2026-10-23' }))).toBe('Every 2 weeks on Friday');
    expect(describeCadence(rule({ freq: 'yearly', anchorDate: '2026-03-15' }))).toBe('Yearly on Mar 15');
  });
});

describe('deterministic ids (D208)', () => {
  it('matches the RFC 9562 uuidv5 reference vector', async () => {
    expect(await uuidv5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe('2ed6657d-e927-568b-95e1-2665a8aea6a2');
  });

  it('gives the same occurrence the same id on every device, and different occurrences different ids', async () => {
    const a = await occurrenceTransactionId('r-1', '2026-10-01');
    expect(await occurrenceTransactionId('r-1', '2026-10-01')).toBe(a);
    expect(await occurrenceTransactionId('r-1', '2026-11-01')).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
