import { describe, expect, it } from 'vitest';
import { receiptDraftFromAi } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('receiptDraftFromAi', () => {
  it('keeps a known category, slices a datetime to a civil date, and converts CAD amounts to USD', () => {
    const draft = receiptDraftFromAi(
      {
        storeName: 'Loblaws',
        date: '2026-03-05T18:00:00Z',
        totalAmount: 13.8,
        taxAmount: 1.38,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 6.9 }],
      },
      'CAD',
      ids(),
    );
    expect(draft.storeName).toBe('Loblaws');
    expect(draft.date).toBe('2026-03-05');
    expect(draft.category).toBe('Groceries');
    expect(draft.categoryTags).toEqual(['Groceries']);
    expect(draft.originalCurrency).toBe('CAD');
    expect(draft.totalAmount).toBeCloseTo(10, 10);
    expect(draft.taxAmount).toBeCloseTo(1, 10);
    expect(draft.lineItems).toHaveLength(1);
    expect(draft.lineItems![0]).toMatchObject({ id: 'id-1', name: 'Milk', category: 'Groceries' });
    expect(draft.lineItems![0].amount).toBeCloseTo(5, 10);
  });

  it('falls unknown categories to Other and drops junk line items, including non-finite amounts', () => {
    const draft = receiptDraftFromAi(
      {
        storeName: 12,
        date: 'not-a-date',
        totalAmount: '12.00',
        taxAmount: Number.NaN,
        category: 'Snacks',
        lineItems: [
          { name: 'Ok', amount: -1.5 },
          { name: 1, amount: 2 },
          { name: 'bad', amount: '2' },
          { name: 'inf', amount: Infinity },
          { amount: 3 },
        ],
      },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.taxAmount).toBeUndefined();
    expect(draft.category).toBe('Other');
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Ok', amount: -1.5, category: 'Other' }]);
  });

  it('treats a missing lineItems array as empty', () => {
    const draft = receiptDraftFromAi({ storeName: 'Aldi', totalAmount: 5, category: 'Dining' }, 'USD', ids());
    expect(draft.lineItems).toEqual([]);
    expect(draft.category).toBe('Dining');
  });
});
