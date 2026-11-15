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
  it('falls back when fields are missing and synthesizes line-item ids', () => {
    const r = toReceipt('r1', { lineItems: [{ name: 'Milk', amount: 3.5 }] }, 'hh');
    expect(r.storeName).toBe('Unknown');
    expect(r.category).toBe('Other');
    expect(r.totalAmount).toBe(0);
    expect(r.lineItems).toEqual([{ id: 'r1-0', name: 'Milk', amount: 3.5, category: undefined, splitWith: undefined }]);
    expect(r.householdId).toBe('hh');
  });
  it('keeps splitWith and treats a non-array lineItems as empty', () => {
    const r = toReceipt('r1', { storeName: 'Aldi', totalAmount: 'nope', lineItems: 'oops', splitWith: ['x'] }, 'hh');
    expect(r.totalAmount).toBe(0);
    expect(r.lineItems).toEqual([]);
  });
});

describe('toIncome / toSettlement / toGoal', () => {
  it('defaults income source and category', () => {
    expect(toIncome('i1', { amountUsd: 50 }, 'hh')).toMatchObject({
      sourceName: 'Income',
      category: 'Other',
      amountUsd: 50,
      householdId: 'hh',
    });
  });
  it('coerces non-numeric settlement amounts to 0', () => {
    expect(toSettlement('s1', { fromUid: 'a', toUid: 'b', amountUsd: '12' }, 'hh').amountUsd).toBe(0);
  });
  it('maps savings goals without inventing notes', () => {
    expect(toGoal('g1', { name: 'Trip', targetUsd: 100, allocatedUsd: 20 }, 'hh').notes).toBeUndefined();
  });
});

describe('investments and member names', () => {
  it('falls unknown kinds back to other and drops non-finite numbers', () => {
    const a = toInvestmentAccount('a1', { name: 'Bag', kind: 'yacht', contributedUsd: NaN, valueUsd: Infinity });
    expect(a.kind).toBe('other');
    expect(a.contributedUsd).toBe(0);
    expect(a.valueUsd).toBe(0);
  });
  it('maps snapshots by accountId', () => {
    expect(toInvestmentSnapshot('s1', { accountId: 'a1', date: '2026-01-01', valueUsd: 10, contributedUsd: 5 })).toMatchObject({
      id: 's1',
      accountId: 'a1',
      valueUsd: 10,
    });
  });
  it('prefers displayName, then email local-part, then Member', () => {
    expect(memberDisplayName('Ada', 'ada@x.com')).toBe('Ada');
    expect(memberDisplayName('', 'ada@x.com')).toBe('ada');
    expect(memberDisplayName(null, null)).toBe('Member');
  });
});
