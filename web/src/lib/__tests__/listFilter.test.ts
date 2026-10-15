import { describe, expect, it } from 'vitest';
import type { Income, Receipt } from '@app/types';
import { filterIncomeRows, filterReceiptRows, sortRecurringTemplates } from '../listFilter';

const r = (o: Partial<Receipt>): Receipt => ({
  id: 'r',
  storeName: 'Shop',
  date: '2026-03-05',
  totalAmount: 10,
  category: 'Groceries',
  createdAt: '',
  updatedAt: '',
  ...o,
});
const inc = (o: Partial<Income>): Income => ({
  id: 'i',
  sourceName: 'Pay',
  date: '2026-03-01',
  amountUsd: 100,
  category: 'Salary',
  earnedBy: 'u1',
  createdAt: '',
  updatedAt: '',
  ...o,
});

describe('filterReceiptRows', () => {
  const rows = [
    r({ id: 'apr', date: '2026-04-02', storeName: 'Costco', notes: 'bulk' }),
    r({ id: 'mar-new', date: '2026-03-20', storeName: 'Aldi', category: 'Dining' }),
    r({ id: 'mar-old', date: '2026-03-02', storeName: 'costco gas', notes: 'fuel' }),
  ];

  it('scopes to the civil month and sorts newest first', () => {
    const out = filterReceiptRows(rows, { scope: 'month', year: 2026, month: 3, query: '', category: 'all' });
    expect(out.map((x) => x.id)).toEqual(['mar-new', 'mar-old']);
  });

  it('all-time keeps every month and still sorts by date', () => {
    const out = filterReceiptRows(rows, { scope: 'all', year: 2026, month: 3, query: '', category: 'all' });
    expect(out.map((x) => x.id)).toEqual(['apr', 'mar-new', 'mar-old']);
  });

  it('matches primary category only, not notes or other months', () => {
    const out = filterReceiptRows(rows, { scope: 'month', year: 2026, month: 3, query: '', category: 'Dining' });
    expect(out.map((x) => x.id)).toEqual(['mar-new']);
  });

  it('searches store or notes case-insensitively after trim', () => {
    const byStore = filterReceiptRows(rows, { scope: 'all', year: 2026, month: 3, query: '  COSTCO ', category: 'all' });
    expect(byStore.map((x) => x.id)).toEqual(['apr', 'mar-old']);
    const byNotes = filterReceiptRows(rows, { scope: 'all', year: 2026, month: 3, query: 'FUEL', category: 'all' });
    expect(byNotes.map((x) => x.id)).toEqual(['mar-old']);
  });
});

describe('filterIncomeRows', () => {
  const rows = [
    inc({ id: 'other-month', date: '2026-02-01', earnedBy: 'u1' }),
    inc({ id: 'u2', date: '2026-03-10', earnedBy: 'u2' }),
    inc({ id: 'u1-new', date: '2026-03-20', earnedBy: 'u1' }),
    inc({ id: 'u1-old', date: '2026-03-02', earnedBy: 'u1' }),
  ];

  it('filters the civil month and sorts newest first', () => {
    expect(filterIncomeRows(rows, { year: 2026, month: 3, earnedBy: 'all' }).map((x) => x.id)).toEqual([
      'u1-new',
      'u2',
      'u1-old',
    ]);
  });

  it('can slice to one earner without leaking other months', () => {
    expect(filterIncomeRows(rows, { year: 2026, month: 3, earnedBy: 'u1' }).map((x) => x.id)).toEqual([
      'u1-new',
      'u1-old',
    ]);
  });
});

describe('sortRecurringTemplates', () => {
  it('drops one-off rows and orders by nextDueDate', () => {
    const out = sortRecurringTemplates([
      r({ id: 'late', recurring: { frequency: 'monthly', nextDueDate: '2026-06-01', endDate: '2027-01-01' } }),
      r({ id: 'once' }),
      r({ id: 'soon', recurring: { frequency: 'weekly', nextDueDate: '2026-05-01', endDate: '2027-01-01' } }),
    ]);
    expect(out.map((x) => x.id)).toEqual(['soon', 'late']);
  });
});
