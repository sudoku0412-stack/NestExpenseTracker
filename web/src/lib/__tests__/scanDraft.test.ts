import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { draftFromParse } from '../scanDraft';

const id = () => 'id';

describe('draftFromParse', () => {
  it('keeps a known category and converts amounts into canonical USD', () => {
    const d = draftFromParse(
      {
        storeName: 'Costco',
        date: '2026-03-05',
        totalAmount: 138,
        taxAmount: 13.8,
        category: 'Groceries',
        lineItems: [{ name: 'Milk', amount: 6.9 }],
      },
      'CAD',
      id,
    );
    expect(d.storeName).toBe('Costco');
    expect(d.date).toBe('2026-03-05');
    expect(d.category).toBe('Groceries');
    expect(d.categoryTags).toEqual(['Groceries']);
    expect(d.originalCurrency).toBe('CAD');
    expect(d.totalAmount).toBeCloseTo(convertEntryToUsd(138, 'CAD'), 8);
    expect(d.taxAmount).toBeCloseTo(convertEntryToUsd(13.8, 'CAD'), 8);
    expect(d.lineItems).toEqual([
      { id: 'id', name: 'Milk', amount: convertEntryToUsd(6.9, 'CAD'), category: 'Groceries' },
    ]);
  });

  it('falls unknown category, missing store, and unreadable totals back to safe defaults', () => {
    const d = draftFromParse({ category: 'Pets', totalAmount: '12', storeName: 9, date: 'March 5' }, 'USD', id);
    expect(d.category).toBe('Other');
    expect(d.storeName).toBe('');
    expect(d.date).toBeUndefined();
    expect(d.totalAmount).toBe(0);
    expect(d.taxAmount).toBeUndefined();
    expect(d.lineItems).toEqual([]);
  });

  it('keeps a date prefix and drops line items without a name or finite amount', () => {
    const d = draftFromParse(
      {
        date: '2026-03-05T12:00:00Z',
        lineItems: [
          { name: 'Milk', amount: 2 },
          { name: 'Bad', amount: 'x' },
          { amount: 3 },
          { name: 'Discount', amount: -1 },
          'junk',
        ],
      },
      'USD',
      id,
    );
    expect(d.date).toBe('2026-03-05');
    expect(d.lineItems?.map((i) => [i.name, i.amount])).toEqual([
      ['Milk', 2],
      ['Discount', -1],
    ]);
  });
});
