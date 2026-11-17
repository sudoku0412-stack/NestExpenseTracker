import { describe, expect, it } from 'vitest';
import { draftFromParsedReceipt, numOrNull } from '../parseAiReceipt';

const ids = () => {
  let n = 0;
  return () => `id-${++n}`;
};

describe('numOrNull', () => {
  it('keeps finite numbers including discounts', () => {
    expect(numOrNull(12.5)).toBe(12.5);
    expect(numOrNull(-3)).toBe(-3);
    expect(numOrNull(0)).toBe(0);
  });
  it('drops non-numbers', () => {
    expect(numOrNull('12.5')).toBeNull();
    expect(numOrNull(Number.NaN)).toBeNull();
    expect(numOrNull(Infinity)).toBeNull();
    expect(numOrNull(null)).toBeNull();
  });
});

describe('draftFromParsedReceipt', () => {
  it('maps a well-formed AI payload and converts CAD into USD-canonical amounts', () => {
    const draft = draftFromParsedReceipt(
      {
        storeName: 'Loblaws',
        date: '2026-03-15T12:00:00',
        totalAmount: 10,
        taxAmount: 1.3,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 4 }, { name: 'Bread', amount: 6 }],
      },
      'CAD',
      ids(),
    );
    expect(draft.storeName).toBe('Loblaws');
    expect(draft.date).toBe('2026-03-15');
    expect(draft.category).toBe('Groceries');
    expect(draft.categoryTags).toEqual(['Groceries']);
    expect(draft.originalCurrency).toBe('CAD');
    expect(draft.totalAmount).toBeCloseTo(10 / 1.38, 5);
    expect(draft.taxAmount).toBeCloseTo(1.3 / 1.38, 5);
    expect(draft.lineItems?.[0]).toMatchObject({ id: 'id-1', name: 'Milk', category: 'Groceries' });
    expect(draft.lineItems?.[0]?.amount).toBeCloseTo(4 / 1.38, 5);
    expect(draft.lineItems?.[1]?.amount).toBeCloseTo(6 / 1.38, 5);
  });

  it('falls unknown categories back to Other and drops junk items and dates', () => {
    const draft = draftFromParsedReceipt(
      {
        storeName: 99,
        date: 'next Tuesday',
        totalAmount: 'lots',
        taxAmount: null,
        category: 'Snacks',
        lineItems: [
          { name: 'OK', amount: 3 },
          { name: '', amount: 1 },
          { name: 'No amount' },
          { amount: 2 },
          { name: 'NaN', amount: Number.NaN },
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
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'OK', amount: 3, category: 'Other' }]);
  });

  it('treats a missing lineItems array as no items', () => {
    const draft = draftFromParsedReceipt({ storeName: 'X', totalAmount: 5, category: 'Dining' }, 'USD', ids());
    expect(draft.lineItems).toEqual([]);
    expect(draft.totalAmount).toBe(5);
  });
});
