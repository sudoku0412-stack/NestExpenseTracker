import { describe, expect, it } from 'vitest';
import { draftFromParsedReceipt } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('draftFromParsedReceipt', () => {
  it('keeps a well-formed scan and converts amounts as the display currency', () => {
    const d = draftFromParsedReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-05',
        totalAmount: 11.5,
        taxAmount: 1.5,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 5 }, { name: 'Eggs', amount: 5 }],
      },
      'USD',
      ids(),
    );
    expect(d).toMatchObject({
      storeName: 'Costco',
      date: '2026-03-05',
      totalAmount: 11.5,
      taxAmount: 1.5,
      category: 'Groceries',
      categoryTags: ['Groceries'],
      originalCurrency: 'USD',
    });
    expect(d.lineItems).toEqual([
      { id: 'id-1', name: 'Milk', amount: 5, category: 'Groceries' },
      { id: 'id-2', name: 'Eggs', amount: 5, category: 'Groceries' },
    ]);
  });

  it('rejects invented categories, non-numeric totals, and junk line items', () => {
    const d = draftFromParsedReceipt(
      {
        storeName: 12,
        date: 'March 5',
        totalAmount: '12.00',
        taxAmount: Number.NaN,
        category: 'Snacks',
        lineItems: [{ name: 'Milk' }, { name: 1, amount: 3 }, { name: 'Eggs', amount: 4 }, 'nope'],
      },
      'USD',
      ids(),
    );
    expect(d.storeName).toBe('');
    expect(d.date).toBeUndefined();
    expect(d.totalAmount).toBe(0);
    expect(d.taxAmount).toBeUndefined();
    expect(d.category).toBe('Other');
    expect(d.lineItems).toEqual([{ id: 'id-1', name: 'Eggs', amount: 4, category: 'Other' }]);
  });

  it('takes the calendar day from an ISO timestamp', () => {
    expect(draftFromParsedReceipt({ date: '2026-03-05T18:00:00.000Z' }, 'USD', ids()).date).toBe('2026-03-05');
  });

  it('converts a CAD scan into canonical USD using the fixed table', () => {
    const d = draftFromParsedReceipt({ totalAmount: 138, lineItems: [{ name: 'X', amount: 138 }] }, 'CAD', ids());
    expect(d.totalAmount).toBeCloseTo(100, 5);
    expect(d.lineItems?.[0].amount).toBeCloseTo(100, 5);
  });
});
