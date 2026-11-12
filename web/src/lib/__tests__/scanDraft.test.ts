import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import { draftFromAiPayload, scanHttpError } from '../scanDraft';

describe('scanHttpError', () => {
  it('maps Premium, unreadable, and generic failures', () => {
    expect(scanHttpError(402)).toBe('AI receipt scanning is a Premium feature.');
    expect(scanHttpError(422)).toBe("Couldn't read that receipt. Try a clearer, flatter photo.");
    expect(scanHttpError(503)).toBe('Scanning is unavailable right now. Try again shortly.');
  });
});

describe('draftFromAiPayload', () => {
  it('drops junk fields, unknown categories, and nameless items', () => {
    const draft = draftFromAiPayload(
      {
        storeName: 12,
        date: 'not-a-date',
        totalAmount: '9',
        category: 'Pets',
        lineItems: [{ name: 'Milk', amount: 3.5 }, { name: 1, amount: 2 }, { name: 'Bad', amount: 'x' }],
      },
      'USD',
      () => 'id-1',
    );
    expect(draft.storeName).toBe('');
    expect(draft.date).toBeUndefined();
    expect(draft.totalAmount).toBe(0);
    expect(draft.category).toBe('Other');
    expect(draft.categoryTags).toEqual(['Other']);
    expect(draft.lineItems).toEqual([{ id: 'id-1', name: 'Milk', amount: 3.5, category: 'Other' }]);
  });

  it('keeps a civil date prefix and converts amounts out of the display currency', () => {
    const draft = draftFromAiPayload(
      {
        storeName: 'Costco',
        date: '2026-04-02T12:00:00Z',
        totalAmount: 13.8,
        taxAmount: 1.38,
        category: 'Groceries',
        lineItems: [{ name: 'Eggs', amount: 13.8 }],
      },
      'CAD',
      () => 'x',
    );
    expect(draft.date).toBe('2026-04-02');
    expect(draft.totalAmount).toBe(convertEntryToUsd(13.8, 'CAD'));
    expect(draft.taxAmount).toBe(convertEntryToUsd(1.38, 'CAD'));
    expect(draft.category).toBe('Groceries');
    expect(draft.originalCurrency).toBe('CAD');
  });
});
