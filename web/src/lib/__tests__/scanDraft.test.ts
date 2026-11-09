import { describe, expect, it } from 'vitest';
import { draftFromAiReceipt } from '../scanDraft';

describe('draftFromAiReceipt', () => {
  const ids = () => {
    let n = 0;
    return () => `id-${++n}`;
  };

  it('keeps a well-formed receipt and converts amounts from the entry currency', () => {
    const draft = draftFromAiReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-04T12:00:00Z',
        totalAmount: 138,
        taxAmount: 8,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 6 }, { name: 'Eggs', amount: 4 }],
      },
      'CAD',
      ids(),
    );
    expect(draft.storeName).toBe('Costco');
    expect(draft.date).toBe('2026-03-04');
    expect(draft.category).toBe('Groceries');
    expect(draft.categoryTags).toEqual(['Groceries']);
    expect(draft.originalCurrency).toBe('CAD');
    expect(draft.totalAmount).toBeCloseTo(100, 5);
    expect(draft.taxAmount).toBeCloseTo(8 / 1.38, 5);
    expect(draft.lineItems).toEqual([
      { id: 'id-1', name: 'Milk', amount: expect.closeTo(6 / 1.38, 5), category: 'Groceries' },
      { id: 'id-2', name: 'Eggs', amount: expect.closeTo(4 / 1.38, 5), category: 'Groceries' },
    ]);
  });

  it('drops unknown categories, bad dates, non-numeric amounts, and items without a numeric amount', () => {
    const draft = draftFromAiReceipt(
      {
        storeName: 12,
        date: 'March 4',
        totalAmount: '12.00',
        taxAmount: NaN,
        category: 'Pets',
        lineItems: [{ name: 'Milk', amount: 3 }, { name: 'X' }, { amount: 1 }, 'nope'],
      },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.taxAmount).toBeUndefined();
    expect(draft.category).toBe('Other');
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Milk', amount: 3, category: 'Other' }]);
  });

  it('keeps a negative discount line', () => {
    const draft = draftFromAiReceipt(
      { storeName: 'Shop', totalAmount: 8, lineItems: [{ name: 'Coupon', amount: -2 }] },
      'USD',
      ids(),
    );
    expect(draft.lineItems?.[0]).toMatchObject({ name: 'Coupon', amount: -2 });
  });
});
