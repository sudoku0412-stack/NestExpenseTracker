import { describe, expect, it } from 'vitest';
import { draftFromParsedReceipt, numOrNull } from '../scanDraft';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('numOrNull', () => {
  it('keeps finite numbers, including discounts', () => {
    expect(numOrNull(12.5)).toBe(12.5);
    expect(numOrNull(-3)).toBe(-3);
    expect(numOrNull('12.5')).toBeNull();
    expect(numOrNull(NaN)).toBeNull();
    expect(numOrNull(Infinity)).toBeNull();
  });
});

describe('draftFromParsedReceipt', () => {
  it('converts CAD amounts to USD and keeps a known category', () => {
    const draft = draftFromParsedReceipt(
      {
        storeName: 'Loblaws',
        date: '2026-03-04',
        totalAmount: 13.8,
        taxAmount: 1.38,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 6.9 }, { name: 'Eggs', amount: 6.9 }],
      },
      'CAD',
      ids(),
    );
    expect(draft.storeName).toBe('Loblaws');
    expect(draft.date).toBe('2026-03-04');
    expect(draft.category).toBe('Groceries');
    expect(draft.originalCurrency).toBe('CAD');
    expect(draft.totalAmount).toBeCloseTo(10, 5);
    expect(draft.taxAmount).toBeCloseTo(1, 5);
    expect(draft.lineItems).toHaveLength(2);
    expect(draft.lineItems![0]).toMatchObject({ id: 'id-1', name: 'Milk', category: 'Groceries' });
    expect(draft.lineItems![0].amount).toBeCloseTo(5, 5);
    expect(draft.lineItems![1].amount).toBeCloseTo(5, 5);
  });

  it('drops junk fields so a hallucinated model cannot poison the save', () => {
    const draft = draftFromParsedReceipt(
      {
        storeName: 99,
        date: 'March 4th',
        totalAmount: '12.00',
        category: 'Snacks',
        lineItems: [
          { name: 'Ok', amount: 1 },
          { name: 'No amount' },
          { amount: 2 },
          { name: 'NaN', amount: NaN },
        ],
      },
      'USD',
      ids(),
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.category).toBe('Other');
    expect(draft.categoryTags).toEqual(['Other']);
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Ok', amount: 1, category: 'Other' }]);
  });
});
