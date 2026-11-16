import { describe, expect, it } from 'vitest';
import { draftFromAiReceipt } from '../scanReceipt';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('draftFromAiReceipt', () => {
  it('keeps a known category, slices a datetime, and converts amounts in the entry currency', () => {
    const draft = draftFromAiReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-05T12:00:00',
        totalAmount: 110,
        taxAmount: 10,
        category: 'Groceries',
        lineItems: [
          { name: 'Milk', amount: 4.5 },
          { name: 'skip me' },
          { amount: 3 },
          { name: 'Eggs', amount: '2' },
        ],
      },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('Costco');
    expect(draft.date).toBe('2026-03-05');
    expect(draft.totalAmount).toBe(110);
    expect(draft.taxAmount).toBe(10);
    expect(draft.category).toBe('Groceries');
    expect(draft.categoryTags).toEqual(['Groceries']);
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Milk', amount: 4.5, category: 'Groceries' }]);
  });

  it('falls back when the model invents a category, a bad date, or a non-numeric total', () => {
    const draft = draftFromAiReceipt(
      { storeName: 12, date: 'March 5', totalAmount: 'lots', category: 'Pets', lineItems: 'none' },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.category).toBe('Other');
    expect(draft.lineItems).toEqual([]);
  });

  it('converts CAD amounts into USD-canonical totals', () => {
    const draft = draftFromAiReceipt({ totalAmount: 138, category: 'Dining' }, 'CAD', ids());
    expect(draft.totalAmount).toBeCloseTo(100, 5);
    expect(draft.originalCurrency).toBe('CAD');
  });
});
