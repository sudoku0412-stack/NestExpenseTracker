import { describe, expect, it } from 'vitest';
import type { Income, Receipt } from '@app/types';
import { computeBudgetSpend, dailySeries, inMonth, shiftMonth, topStores, trend, upcomingRecurring } from '../stats';

const r = (o: Partial<Receipt>): Receipt => ({ id: 'r', storeName: 'Shop', date: '2026-03-05', totalAmount: 100, category: 'Groceries', createdAt: '', updatedAt: '', ...o });
const inc = (o: Partial<Income>): Income => ({ id: 'i', sourceName: 'Pay', date: '2026-03-01', amountUsd: 1000, category: 'Salary', earnedBy: 'u', createdAt: '', updatedAt: '', ...o });

describe('computeBudgetSpend', () => {
  it('attributes a receipt without items to its own category', () => {
    expect(computeBudgetSpend([r({})])).toEqual({ Groceries: 100 });
  });
  it('splits the receipt total across item categories in proportion, tax included', () => {
    const out = computeBudgetSpend([r({ totalAmount: 110, lineItems: [{ id: 'a', name: 'a', amount: 60, category: 'Groceries' }, { id: 'b', name: 'b', amount: 40, category: 'Clothing' }] })]);
    expect(out.Groceries).toBeCloseTo(66, 5);
    expect(out.Clothing).toBeCloseTo(44, 5);
  });
  it('adds recurring expenses to the Recurring key too, without double counting a Recurring-category receipt', () => {
    const out = computeBudgetSpend([r({ recurring: { frequency: 'monthly', nextDueDate: '2026-04-05', endDate: '2027-01-01' } }), r({ category: 'Recurring', isRecurringOccurrence: true, totalAmount: 50 })]);
    expect(out.Recurring).toBe(150);
    expect(out.Groceries).toBe(100);
  });
});

describe('month helpers', () => {
  it('filters by calendar month, treating date-only strings as that civil day', () => {
    expect(inMonth([r({ date: '2026-03-01' }), r({ date: '2026-04-01' })], 2026, 3)).toHaveLength(1);
  });
  it('shifts across year boundaries', () => {
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
  });
  it('builds a running total across the month', () => {
    const d = dailySeries([r({ date: '2026-02-02', totalAmount: 10 }), r({ date: '2026-02-04', totalAmount: 5 })], 2026, 2);
    expect(d).toHaveLength(28);
    expect(d[1].spent).toBe(10);
    expect(d[27].total).toBe(15);
  });
});

describe('trend and stores', () => {
  it('returns earned, spent and net per month, oldest first', () => {
    const t = trend([r({ date: '2026-03-05', totalAmount: 300 }), r({ date: '2026-02-05', totalAmount: 100 })], [inc({ date: '2026-03-01', amountUsd: 1000 })], 2026, 3, 2);
    expect(t.map((x) => x.label)).toEqual(['Feb', 'Mar']);
    expect(t[1]).toMatchObject({ spent: 300, earned: 1000, net: 700 });
  });
  it('groups stores case-insensitively and sorts by total', () => {
    const s = topStores([r({ storeName: 'Costco', totalAmount: 50 }), r({ storeName: 'costco ', totalAmount: 70 }), r({ storeName: 'Aldi', totalAmount: 90 })]);
    expect(s.map((x) => [x.store, x.total, x.count])).toEqual([['Costco', 120, 2], ['Aldi', 90, 1]]);
  });
  it('lists only active recurring templates, soonest first', () => {
    const out = upcomingRecurring([
      r({ id: 'late', recurring: { frequency: 'monthly', nextDueDate: '2026-06-01', endDate: '2027-01-01' } }),
      r({ id: 'soon', recurring: { frequency: 'weekly', nextDueDate: '2026-05-01', endDate: '2027-01-01' } }),
      r({ id: 'ended', recurring: { frequency: 'weekly', nextDueDate: '2026-05-01', endDate: '2026-01-01' } }),
    ], new Date('2026-04-15T12:00:00Z'));
    expect(out.map((x) => x.receipt.id)).toEqual(['soon', 'late']);
  });
});
