import { describe, expect, it } from 'vitest';
import {
  memberDisplayName,
  num,
  str,
  toGoal,
  toIncome,
  toInvestmentAccount,
  toInvestmentSnapshot,
  toReceipt,
  toSettlement,
} from '../firestoreMap';

describe('str / num', () => {
  it('keeps strings and falls back otherwise', () => {
    expect(str('Costco')).toBe('Costco');
    expect(str(null, 'Unknown')).toBe('Unknown');
    expect(str(12, 'Unknown')).toBe('Unknown');
  });
  it('accepts finite numbers only', () => {
    expect(num(19.99)).toBe(19.99);
    expect(num('19.99')).toBe(0);
    expect(num(Number.NaN)).toBe(0);
    expect(num(Infinity)).toBe(0);
  });
});

describe('toReceipt', () => {
  it('fills defaults for a sparse cloud row', () => {
    const r = toReceipt('r1', {}, 'hh');
    expect(r).toMatchObject({
      id: 'r1',
      householdId: 'hh',
      storeName: 'Unknown',
      category: 'Other',
      totalAmount: 0,
      lineItems: [],
      isRecurringOccurrence: false,
    });
  });
  it('synthesizes line item ids and drops non-numeric amounts', () => {
    const r = toReceipt(
      'r1',
      {
        storeName: 'Aldi',
        totalAmount: 12,
        lineItems: [{ name: 'Milk', amount: 4 }, { id: 'i2', name: 'Eggs', amount: '3' }],
      },
      'hh',
    );
    expect(r.lineItems).toEqual([
      { id: 'r1-0', name: 'Milk', amount: 4, category: undefined, splitWith: undefined },
      { id: 'i2', name: 'Eggs', amount: 0, category: undefined, splitWith: undefined },
    ]);
  });
  it('treats a missing lineItems array as empty, not a crash', () => {
    expect(toReceipt('r1', { lineItems: 'nope' }, 'hh').lineItems).toEqual([]);
  });
});

describe('toIncome / toSettlement / toGoal', () => {
  it('defaults income category and source', () => {
    expect(toIncome('i1', { amountUsd: 500 }, 'hh')).toMatchObject({
      id: 'i1',
      sourceName: 'Income',
      category: 'Other',
      amountUsd: 500,
      householdId: 'hh',
    });
  });
  it('zeros a non-numeric settlement so balances cannot NaN', () => {
    expect(toSettlement('s1', { fromUid: 'a', toUid: 'b', amountUsd: '50' }, 'hh').amountUsd).toBe(0);
  });
  it('zeros a non-numeric goal allocation', () => {
    expect(toGoal('g1', { name: 'Trip', targetUsd: 1000, allocatedUsd: null }, 'hh').allocatedUsd).toBe(0);
  });
});

describe('investments', () => {
  it('maps a known kind and falls back unknown kinds to other', () => {
    expect(toInvestmentAccount('a1', { name: 'TFSA', kind: 'etf', contributedUsd: 10, valueUsd: 12 }).kind).toBe('etf');
    expect(toInvestmentAccount('a1', { name: 'X', kind: 'yacht' }).kind).toBe('other');
  });
  it('maps a snapshot with numeric guards', () => {
    expect(toInvestmentSnapshot('s1', { accountId: 'a1', date: '2026-01-01', valueUsd: 'x' })).toMatchObject({
      id: 's1',
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 0,
      contributedUsd: 0,
    });
  });
});

describe('memberDisplayName', () => {
  it('prefers display name, then email local-part, then Member', () => {
    expect(memberDisplayName('Ada', 'ada@x.com')).toBe('Ada');
    expect(memberDisplayName('', 'ada@x.com')).toBe('ada');
    expect(memberDisplayName(null, null)).toBe('Member');
  });
});
