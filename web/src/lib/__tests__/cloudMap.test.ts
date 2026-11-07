import { describe, expect, it } from 'vitest';
import { memberFromUserDoc, toGoal, toIncome, toInvestmentAccount, toInvestmentSnapshot, toReceipt, toSettlement } from '../cloudMap';

describe('toReceipt', () => {
  it('fills safe defaults for a sparse Firestore doc', () => {
    const r = toReceipt('r1', {}, 'hh1');
    expect(r).toMatchObject({
      id: 'r1',
      storeName: 'Unknown',
      category: 'Other',
      totalAmount: 0,
      householdId: 'hh1',
      isRecurringOccurrence: false,
      lineItems: [],
    });
  });

  it('keeps split and paidBy, and synthesizes line-item ids', () => {
    const r = toReceipt(
      'r1',
      {
        storeName: 'Costco',
        totalAmount: 40,
        split: { enabled: true, method: 'equal', participantIds: ['a', 'b'] },
        paidBy: 'a',
        lineItems: [{ name: 'Milk', amount: 4 }],
      },
      'hh1',
    );
    expect(r.split?.participantIds).toEqual(['a', 'b']);
    expect(r.paidBy).toBe('a');
    expect(r.lineItems?.[0]).toMatchObject({ id: 'r1-0', name: 'Milk', amount: 4 });
  });

  it('drops non-numeric totals instead of NaN-ing dashboards', () => {
    expect(toReceipt('r1', { totalAmount: '12.5' }, 'hh1').totalAmount).toBe(0);
  });
});

describe('toIncome', () => {
  it('defaults source and category', () => {
    const i = toIncome('i1', { amountUsd: 100 }, 'hh1');
    expect(i.sourceName).toBe('Income');
    expect(i.category).toBe('Other');
    expect(i.amountUsd).toBe(100);
  });
});

describe('toSettlement / toGoal', () => {
  it('maps settlement parties and treats junk amounts as 0', () => {
    expect(toSettlement('s1', { fromUid: 'a', toUid: 'b', amountUsd: 'nope' }, 'hh1')).toMatchObject({
      fromUid: 'a',
      toUid: 'b',
      amountUsd: 0,
      householdId: 'hh1',
    });
  });

  it('maps a savings goal', () => {
    expect(toGoal('g1', { name: 'Trip', targetUsd: 500, allocatedUsd: 20 }, 'hh1')).toMatchObject({
      name: 'Trip',
      targetUsd: 500,
      allocatedUsd: 20,
    });
  });
});

describe('investments', () => {
  it('coerces an unknown kind to other so personal holdings still show', () => {
    expect(toInvestmentAccount('a1', { name: 'Wallet', kind: 'nft', valueUsd: 9, contributedUsd: 8 }).kind).toBe('other');
  });

  it('maps a snapshot under the account id', () => {
    expect(toInvestmentSnapshot('s1', { accountId: 'a1', date: '2026-01-01', valueUsd: 10, contributedUsd: 8 })).toMatchObject({
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 10,
    });
  });
});

describe('memberFromUserDoc', () => {
  it('prefers displayName, then email local-part, then Member', () => {
    expect(memberFromUserDoc('u1', { displayName: 'Ada', email: 'ada@x.com' }).name).toBe('Ada');
    expect(memberFromUserDoc('u1', { email: 'ada@x.com' }).name).toBe('ada');
    expect(memberFromUserDoc('u1', undefined).name).toBe('Member');
  });
});
