import { describe, expect, it } from 'vitest';
import { draftFromParsedReceipt } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('draftFromParsedReceipt', () => {
  it('keeps a valid category, date, amounts and named line items', () => {
    const draft = draftFromParsedReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-04T12:00:00Z',
        totalAmount: 11.5,
        taxAmount: 1.5,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 4 }, { name: 'skip me' }, { name: 'Eggs', amount: 3 }],
      },
      'USD',
      ids(),
    );
    expect(draft).toMatchObject({
      storeName: 'Costco',
      date: '2026-03-04',
      totalAmount: 11.5,
      taxAmount: 1.5,
      category: 'Groceries',
      categoryTags: ['Groceries'],
      originalCurrency: 'USD',
    });
    expect(draft.lineItems).toEqual([
      { id: 'id-1', name: 'Milk', amount: 4, category: 'Groceries' },
      { id: 'id-2', name: 'Eggs', amount: 3, category: 'Groceries' },
    ]);
  });

  it('does not trust an invented category, a non-ISO date, or a non-numeric total', () => {
    const draft = draftFromParsedReceipt(
      { storeName: 12, date: 'March 4', totalAmount: '12', category: 'Pets', lineItems: 'nope' },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.category).toBe('Other');
    expect(draft.lineItems).toEqual([]);
  });
});
