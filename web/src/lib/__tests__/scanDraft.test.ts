import { describe, expect, it } from 'vitest';
import { receiptDraftFromAi } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('receiptDraftFromAi', () => {
  it('keeps a well-formed scan and copies the category onto each item', () => {
    const draft = receiptDraftFromAi(
      {
        storeName: 'Costco',
        date: '2026-03-05T12:00:00Z',
        totalAmount: 12.5,
        taxAmount: 1.1,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 4 }, { name: 'Eggs', amount: 6 }],
      },
      'USD',
      ids(),
    );
    expect(draft).toMatchObject({
      storeName: 'Costco',
      date: '2026-03-05',
      totalAmount: 12.5,
      taxAmount: 1.1,
      category: 'Groceries',
      categoryTags: ['Groceries'],
      originalCurrency: 'USD',
    });
    expect(draft.lineItems).toEqual([
      { id: 'id-1', name: 'Milk', amount: 4, category: 'Groceries' },
      { id: 'id-2', name: 'Eggs', amount: 6, category: 'Groceries' },
    ]);
  });

  it('does not trust unknown categories, bad dates, or junk line items', () => {
    const draft = receiptDraftFromAi(
      {
        storeName: 99,
        date: 'March 5',
        totalAmount: '12.5',
        taxAmount: NaN,
        category: 'Snacks',
        lineItems: [{ name: 'Milk' }, { name: 1, amount: 2 }, { name: 'Skip', amount: '3' }, { name: 'Ok', amount: -1.5 }],
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
});
