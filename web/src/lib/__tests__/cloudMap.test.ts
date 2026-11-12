import { describe, expect, it } from 'vitest';
import {
  householdBudgetState,
  memberFromUserDoc,
  num,
  toGoal,
  toIncome,
  toInvestmentAccount,
  toReceipt,
  toSettlement,
} from '../cloudMap';

describe('num / toReceipt', () => {
  it('treats non-finite totals as zero and missing store as Unknown', () => {
    const r = toReceipt('r1', { storeName: 9, totalAmount: Number.NaN, lineItems: 'nope' }, 'h1');
    expect(r.storeName).toBe('Unknown');
    expect(r.totalAmount).toBe(0);
    expect(r.category).toBe('Other');
    expect(r.lineItems).toEqual([]);
    expect(r.householdId).toBe('h1');
  });

  it('synthesizes line-item ids and ignores non-numeric amounts', () => {
    const r = toReceipt(
      'r2',
      {
        storeName: 'Aldi',
        date: '2026-03-01',
        totalAmount: 12.5,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: '2' }, { id: 'i1', name: 'Eggs', amount: 3.5, category: 'Groceries' }],
      },
      'h1',
    );
    expect(r.lineItems).toEqual([
      { id: 'r2-0', name: 'Milk', amount: 0, category: undefined, splitWith: undefined },
      { id: 'i1', name: 'Eggs', amount: 3.5, category: 'Groceries', splitWith: undefined },
    ]);
  });
});

describe('toIncome / toSettlement / toGoal', () => {
  it('defaults income source and category', () => {
    const i = toIncome('i1', { amountUsd: 50 }, 'h1');
    expect(i.sourceName).toBe('Income');
    expect(i.category).toBe('Other');
    expect(i.amountUsd).toBe(50);
    expect(i.earnedBy).toBe('');
  });

  it('zeros non-numeric settlement amounts', () => {
    expect(toSettlement('s1', { fromUid: 'a', toUid: 'b', amountUsd: '5' }, 'h1').amountUsd).toBe(0);
  });

  it('maps a savings goal', () => {
    const g = toGoal('g1', { name: 'Trip', targetUsd: 1000, allocatedUsd: 200 }, 'h1');
    expect(g).toMatchObject({ id: 'g1', name: 'Trip', targetUsd: 1000, allocatedUsd: 200, householdId: 'h1' });
  });
});

describe('investments and members', () => {
  it('falls unknown investment kinds back to other', () => {
    expect(toInvestmentAccount('a1', { name: 'Broker', kind: 'bonds', contributedUsd: 10, valueUsd: 12 }).kind).toBe('other');
    expect(toInvestmentAccount('a1', { kind: 'crypto' }).kind).toBe('crypto');
  });

  it('uses email local-part when displayName is missing', () => {
    expect(memberFromUserDoc('u1', { email: 'sam@example.com' })).toEqual({
      uid: 'u1',
      name: 'sam',
      email: 'sam@example.com',
    });
    expect(memberFromUserDoc('u2', undefined)).toEqual({ uid: 'u2', name: 'Member', email: null });
  });

  it('treats missing alertsEnabled as on, and a missing byCategory as empty', () => {
    expect(householdBudgetState({})).toEqual({ budgets: {}, budgetAlerts: true, customCategories: [] });
    expect(householdBudgetState({ budgets: { alertsEnabled: false, byCategory: { Groceries: 50 } } })).toEqual({
      budgets: { Groceries: 50 },
      budgetAlerts: false,
      customCategories: [],
    });
  });

  it('num rejects strings', () => {
    expect(num('3')).toBe(0);
    expect(num(3.25)).toBe(3.25);
  });
});
