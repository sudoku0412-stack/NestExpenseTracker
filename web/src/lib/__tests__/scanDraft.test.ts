import { describe, expect, it } from 'vitest';
import { draftFromAiReceipt } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('draftFromAiReceipt', () => {
  it('keeps a well-formed receipt and converts amounts in the entry currency', () => {
    const draft = draftFromAiReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-05T12:00:00Z',
        totalAmount: 12.5,
        taxAmount: 1.1,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 4.5 }, { name: 'Eggs', amount: 6 }],
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
      { id: 'id-1', name: 'Milk', amount: 4.5, category: 'Groceries' },
      { id: 'id-2', name: 'Eggs', amount: 6, category: 'Groceries' },
    ]);
  });

  it('drops hallucinated categories, bad dates, NaN amounts and nameless items', () => {
    const draft = draftFromAiReceipt(
      {
        storeName: 99,
        date: 'March 5',
        totalAmount: '12',
        taxAmount: Number.NaN,
        category: 'Snacks',
        lineItems: [{ name: 'Milk', amount: 'x' }, { amount: 4 }, { name: 'Ok', amount: -1.25 }],
      },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.taxAmount).toBeUndefined();
    expect(draft.category).toBe('Other');
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Ok', amount: -1.25, category: 'Other' }]);
  });

  it('treats a missing lineItems array as empty', () => {
    expect(draftFromAiReceipt({ storeName: 'Aldi', totalAmount: 8, category: 'Dining' }, 'USD', ids()).lineItems).toEqual([]);
  });
});
