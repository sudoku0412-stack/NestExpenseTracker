import { describe, expect, it } from 'vitest';
import {
  memberDisplayName,
  toGoal,
  toIncome,
  toInvestmentAccount,
  toInvestmentSnapshot,
  toReceipt,
  toSettlement,
} from '../mappers';

describe('toReceipt', () => {
  it('fills safe defaults for a sparse Firestore doc and synthesizes line-item ids', () => {
    const r = toReceipt('r1', { totalAmount: 'nope', lineItems: [{ name: 'Milk', amount: 3.5 }] }, 'hh1');
    expect(r).toMatchObject({
      id: 'r1',
      storeName: 'Unknown',
      category: 'Other',
      totalAmount: 0,
      householdId: 'hh1',
      isRecurringOccurrence: false,
    });
    expect(r.lineItems).toEqual([{ id: 'r1-0', name: 'Milk', amount: 3.5, category: undefined, splitWith: undefined }]);
  });

  it('keeps a real store, category tags, and a zero total', () => {
    const r = toReceipt('r2', { storeName: 'Aldi', totalAmount: 0, category: 'Groceries', categoryTags: ['Groceries'] }, 'hh1');
    expect(r.storeName).toBe('Aldi');
    expect(r.totalAmount).toBe(0);
    expect(r.categoryTags).toEqual(['Groceries']);
  });
});

describe('toIncome / toSettlement / toGoal', () => {
  it('defaults an income source and category, and treats non-numeric amounts as 0', () => {
    expect(toIncome('i1', { amountUsd: null }, 'hh1')).toMatchObject({
      sourceName: 'Income',
      category: 'Other',
      amountUsd: 0,
      earnedBy: '',
    });
  });

  it('maps a settlement and a goal without trusting non-numeric money', () => {
    expect(toSettlement('s1', { fromUid: 'a', toUid: 'b', amountUsd: '10' }, 'hh1').amountUsd).toBe(0);
    expect(toGoal('g1', { name: 'Trip', targetUsd: 500, allocatedUsd: 20 }, 'hh1')).toMatchObject({
      name: 'Trip',
      targetUsd: 500,
      allocatedUsd: 20,
      householdId: 'hh1',
    });
  });
});

describe('investments', () => {
  it('falls unknown kinds back to other and ignores non-finite money', () => {
    expect(toInvestmentAccount('a1', { name: 'Bag', kind: 'nft', contributedUsd: NaN, valueUsd: Infinity })).toMatchObject({
      name: 'Bag',
      kind: 'other',
      contributedUsd: 0,
      valueUsd: 0,
    });
    expect(toInvestmentAccount('a1', { kind: 'crypto', valueUsd: 9 }).kind).toBe('crypto');
  });

  it('maps a snapshot', () => {
    expect(toInvestmentSnapshot('s1', { accountId: 'a1', date: '2026-01-01', valueUsd: 10, contributedUsd: 8 })).toMatchObject({
      id: 's1',
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 10,
      contributedUsd: 8,
    });
  });
});

describe('memberDisplayName', () => {
  it('prefers displayName, then the email local-part, then Member', () => {
    expect(memberDisplayName('Ada', 'ada@x.com')).toBe('Ada');
    expect(memberDisplayName('', 'ada@x.com')).toBe('ada');
    expect(memberDisplayName(null, null)).toBe('Member');
  });
});
