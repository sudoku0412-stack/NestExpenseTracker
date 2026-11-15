import { describe, expect, it } from 'vitest';
import { draftFromParsedReceipt } from '../scanDraft';

describe('draftFromParsedReceipt', () => {
  it('keeps a known category and converts amounts in the entry currency', () => {
    const draft = draftFromParsedReceipt(
      {
        storeName: 'Costco',
        date: '2026-03-04T12:00:00',
        category: 'Groceries',
        totalAmount: 10,
        taxAmount: 1,
        lineItems: [{ name: 'Milk', amount: 4 }, { name: 'skip-me' }],
      },
      'USD',
      () => 'id-1',
    );
    expect(draft).toMatchObject({
      storeName: 'Costco',
      date: '2026-03-04',
      category: 'Groceries',
      categoryTags: ['Groceries'],
      totalAmount: 10,
      taxAmount: 1,
      originalCurrency: 'USD',
    });
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Milk', amount: 4, category: 'Groceries' }]);
  });

  it('drops untrusted category/date/store and ignores non-numeric totals', () => {
    const draft = draftFromParsedReceipt(
      { storeName: 12, date: 'March 4', category: 'Yacht', totalAmount: '10', lineItems: 'nope' },
      'USD',
      () => 'x',
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.category).toBe('Other');
    expect(draft.totalAmount).toBe(0);
    expect(draft.lineItems).toEqual([]);
  });
});
