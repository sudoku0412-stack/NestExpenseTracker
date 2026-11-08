import { describe, expect, it } from 'vitest';
import { draftFromParsedReceipt, numOrNull } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('draftFromParsedReceipt', () => {
  it('keeps a known category, date, and finite amounts', () => {
    const d = draftFromParsedReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-05T12:00:00Z',
        totalAmount: 20,
        taxAmount: 1.5,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 4 }, { name: 'skip me' }, { name: 'Eggs', amount: '3' }],
      },
      'USD',
      ids(),
    );
    expect(d).toMatchObject({
      storeName: 'Costco',
      date: '2026-03-05',
      totalAmount: 20,
      taxAmount: 1.5,
      category: 'Groceries',
      categoryTags: ['Groceries'],
      originalCurrency: 'USD',
    });
    expect(d.lineItems).toEqual([{ id: 'id-1', name: 'Milk', amount: 4, category: 'Groceries' }]);
  });

  it('falls back when the model invents a category, a bad date, or non-numeric totals', () => {
    const d = draftFromParsedReceipt(
      { storeName: 9, date: 'March 5', totalAmount: '12.00', category: 'Investments', lineItems: 'nope' },
      'USD',
      ids(),
    );
    expect(d.storeName).toBe('');
    expect(d.date).toBeUndefined();
    expect(d.totalAmount).toBe(0);
    expect(d.category).toBe('Other');
    expect(d.lineItems).toEqual([]);
  });

  it('converts amounts out of a non-USD display currency into USD-canonical', () => {
    const d = draftFromParsedReceipt({ totalAmount: 0.92, category: 'Dining' }, 'EUR', ids());
    expect(d.totalAmount).toBeCloseTo(1, 5);
  });
});

describe('numOrNull', () => {
  it('rejects non-finite numbers', () => {
    expect(numOrNull(3)).toBe(3);
    expect(numOrNull(NaN)).toBeNull();
    expect(numOrNull('3')).toBeNull();
  });
});
