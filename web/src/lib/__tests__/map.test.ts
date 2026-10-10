import { describe, expect, it } from 'vitest';
import { num, str, toIncome, toInvestmentAccount, toInvestmentSnapshot, toReceipt } from '../map';

describe('str / num', () => {
  it('falls back for non-strings and non-finite numbers', () => {
    expect(str(undefined, 'Unknown')).toBe('Unknown');
    expect(str(12 as unknown as string, 'Unknown')).toBe('Unknown');
    expect(num('12')).toBe(0);
    expect(num(Number.NaN)).toBe(0);
    expect(num(19.5)).toBe(19.5);
  });
});

describe('toReceipt', () => {
  it('uses safe defaults when the cloud row is sparse or corrupt', () => {
    const r = toReceipt('r1', { totalAmount: 'nope', lineItems: 'oops', categoryTags: 'x' }, 'hh1');
    expect(r).toMatchObject({
      id: 'r1',
      householdId: 'hh1',
      storeName: 'Unknown',
      category: 'Other',
      totalAmount: 0,
      lineItems: [],
      categoryTags: undefined,
      isRecurringOccurrence: false,
    });
  });

  it('keeps line-item splitWith and fills a missing item id', () => {
    const r = toReceipt(
      'r1',
      {
        storeName: 'Costco',
        date: '2026-03-01',
        totalAmount: 10,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 4, splitWith: ['u1', 'u2'] }, { id: 'kept', name: 'Eggs', amount: 6 }],
      },
      'hh1',
    );
    expect(r.lineItems).toEqual([
      { id: 'r1-0', name: 'Milk', amount: 4, category: undefined, splitWith: ['u1', 'u2'] },
      { id: 'kept', name: 'Eggs', amount: 6, category: undefined, splitWith: undefined },
    ]);
  });
});

describe('toIncome', () => {
  it('defaults source and category and rejects a non-numeric amount', () => {
    expect(toIncome('i1', { amountUsd: '1000' }, 'hh1')).toMatchObject({
      id: 'i1',
      sourceName: 'Income',
      category: 'Other',
      amountUsd: 0,
      householdId: 'hh1',
    });
  });
});

describe('investments', () => {
  it('maps an unknown kind to other and zeros bad numbers', () => {
    expect(toInvestmentAccount('a1', { name: 'Wallet', kind: 'nft', contributedUsd: 'x', valueUsd: 50 })).toEqual({
      id: 'a1',
      name: 'Wallet',
      kind: 'other',
      contributedUsd: 0,
      valueUsd: 50,
      notes: undefined,
      createdAt: '',
      updatedAt: '',
    });
  });

  it('maps a snapshot', () => {
    expect(toInvestmentSnapshot('s1', { accountId: 'a1', date: '2026-01-01', valueUsd: 1, contributedUsd: 1, createdAt: 't' })).toEqual({
      id: 's1',
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 1,
      contributedUsd: 1,
      createdAt: 't',
    });
  });
});
