import { describe, expect, it } from 'vitest';
import { budgetAlertsEnabled, goalRatio, memberDisplayName, nextAllocatedUsd } from '../householdFields';
import { formatGroupedMoney } from '../moneyFormat';
import { mapWebInvestmentAccount, mapWebInvestmentSnapshot } from '../investmentMap';
import { settlementAmountUsd, settlementParties } from '../settle';

describe('settlementParties', () => {
  it('they pay you when they owe you, and you pay them when you owe them', () => {
    expect(settlementParties('me', 'bob', 40)).toEqual({ fromUid: 'bob', toUid: 'me' });
    expect(settlementParties('me', 'bob', -12.5)).toEqual({ fromUid: 'me', toUid: 'bob' });
    expect(settlementParties('me', 'bob', 0)).toEqual({ fromUid: 'me', toUid: 'bob' });
  });

  it('uses the typed amount when present, otherwise the full abs(net)', () => {
    expect(settlementAmountUsd('10', 40, (n) => n * 2)).toBe(20);
    expect(settlementAmountUsd('', 40, (n) => n * 2)).toBe(40);
    expect(settlementAmountUsd(undefined, -15, (n) => n)).toBe(15);
  });
});

describe('household fields', () => {
  it('treats missing budget alerts as on, and only false as off', () => {
    expect(budgetAlertsEnabled(undefined)).toBe(true);
    expect(budgetAlertsEnabled(true)).toBe(true);
    expect(budgetAlertsEnabled(false)).toBe(false);
  });

  it('falls back from display name to email local-part to Member', () => {
    expect(memberDisplayName({ displayName: 'Ada', email: 'ada@x.com' })).toEqual({ name: 'Ada', email: 'ada@x.com' });
    expect(memberDisplayName({ displayName: '', email: 'bob@x.com' })).toEqual({ name: 'bob', email: 'bob@x.com' });
    expect(memberDisplayName({})).toEqual({ name: 'Member', email: null });
  });

  it('clamps a take-out so allocated cannot go negative, and caps the ratio at 1', () => {
    expect(nextAllocatedUsd(40, -15)).toBe(25);
    expect(nextAllocatedUsd(10, -50)).toBe(0);
    expect(goalRatio(25, 100)).toBe(0.25);
    expect(goalRatio(150, 100)).toBe(1);
    expect(goalRatio(10, 0)).toBe(0);
  });
});

describe('formatGroupedMoney', () => {
  it('groups thousands and uses a non-wrapping minus', () => {
    expect(formatGroupedMoney(1234.5, '$1234.50')).toBe('$1,234.50');
    expect(formatGroupedMoney(-50, '$50.00')).toBe('\u2212$50.00');
    expect(formatGroupedMoney(10, '₹150')).toBe('₹150');
  });
});

describe('web investment mapper', () => {
  it('rejects a numeric-string amount (web requires a real number) and unknown kinds', () => {
    const a = mapWebInvestmentAccount('a1', { name: 'TFSA', kind: 'yacht', contributedUsd: '1000', valueUsd: 12 });
    expect(a.kind).toBe('other');
    expect(a.contributedUsd).toBe(0);
    expect(a.valueUsd).toBe(12);
    expect(mapWebInvestmentSnapshot('s', { accountId: 'a1', valueUsd: Number.NaN }).valueUsd).toBe(0);
  });
});
