import { describe, expect, it } from 'vitest';
import { convertEntryToUsd } from '@app/lib/currency';
import {
  buildReceiptSplit,
  buildReceiptWrite,
  itemsPlusTaxMismatch,
  receiptDateIso,
  round2,
  validateReceiptDraft,
} from '../receiptDraft';

const base = {
  store: 'Costco',
  total: '110',
  tags: ['Groceries'],
  items: [] as { key: string; name: string; amount: string; category: string }[],
  splitOn: false,
  method: 'equal' as const,
  people: ['a', 'b'],
  vals: {} as Record<string, string>,
};

describe('validateReceiptDraft', () => {
  it('rejects a blank store, non-positive total, and no categories', () => {
    expect(validateReceiptDraft({ ...base, store: '  ' })).toBe('Enter the store name.');
    expect(validateReceiptDraft({ ...base, total: '0' })).toBe('Enter a total greater than zero.');
    expect(validateReceiptDraft({ ...base, total: '-1' })).toBe('Enter a total greater than zero.');
    expect(validateReceiptDraft({ ...base, tags: [] })).toBe('Pick at least one category.');
  });

  it('allows an empty item list but requires a non-zero finite amount once an item exists', () => {
    expect(validateReceiptDraft(base)).toBeNull();
    expect(validateReceiptDraft({ ...base, items: [{ key: '1', name: 'Milk', amount: '0', category: 'Groceries' }] })).toBe(
      'Each item needs a name and an amount.',
    );
    expect(validateReceiptDraft({ ...base, items: [{ key: '1', name: '  ', amount: '3', category: 'Groceries' }] })).toBe(
      'Each item needs a name and an amount.',
    );
    expect(validateReceiptDraft({ ...base, items: [{ key: '1', name: 'Milk', amount: '-2.5', category: 'Groceries' }] })).toBeNull();
  });

  it('requires two people and balanced percent/amount/shares when splitting', () => {
    expect(validateReceiptDraft({ ...base, splitOn: true, people: ['a'] })).toBe('Choose at least two people to split with.');
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'percent', vals: { a: '40', b: '50' } })).toBe(
      'Percentages must add up to 100.',
    );
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'amount', vals: { a: '50', b: '50' } })).toBe(
      'Amounts must add up to the total.',
    );
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'shares', vals: { a: '0', b: '0' } })).toBe(
      'Give at least one person a share.',
    );
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'percent', vals: { a: '40', b: '60' } })).toBeNull();
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'amount', vals: { a: '70', b: '40' } })).toBeNull();
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'shares', vals: { a: '2', b: '1' } })).toBeNull();
    expect(validateReceiptDraft({ ...base, splitOn: true, method: 'equal' })).toBeNull();
  });
});

describe('buildReceiptSplit', () => {
  it('stores equal splits without values, and converts amount splits to USD', () => {
    expect(buildReceiptSplit(false, 'equal', ['a', 'b'], {}, 'USD')).toBeNull();
    expect(buildReceiptSplit(true, 'equal', ['a', 'b'], {}, 'USD')).toEqual({
      enabled: true,
      method: 'equal',
      participantIds: ['a', 'b'],
    });
    const cad = buildReceiptSplit(true, 'amount', ['a', 'b'], { a: '69', b: '69' }, 'CAD');
    expect(cad?.values?.a).toBe(round2(convertEntryToUsd(69, 'CAD')));
    expect(cad?.values?.b).toBe(round2(convertEntryToUsd(69, 'CAD')));
  });

  it('keeps percent and share values in the typed units, not USD', () => {
    expect(buildReceiptSplit(true, 'percent', ['a', 'b'], { a: '40', b: '60' }, 'CAD')?.values).toEqual({ a: 40, b: 60 });
    expect(buildReceiptSplit(true, 'shares', ['a', 'b'], { a: '2', b: '1' }, 'EUR')?.values).toEqual({ a: 2, b: 1 });
  });
});

describe('buildReceiptWrite', () => {
  const write = (over: Partial<Parameters<typeof buildReceiptWrite>[0]> = {}) =>
    buildReceiptWrite({
      id: 'r1',
      store: '  Costco  ',
      date: '2026-03-05',
      total: '138',
      tax: '13.80',
      tags: ['Groceries', 'Household'],
      notes: '  weekly  ',
      items: [{ key: 'i1', name: '  Milk  ', amount: '69', category: 'Groceries' }],
      split: null,
      repeat: { enabled: false, frequency: 'monthly', months: '12' },
      paidBy: '',
      fallbackUid: 'u1',
      currency: 'CAD',
      now: '2026-03-05T18:00:00.000Z',
      isNew: true,
      ...over,
    });

  it('converts CAD totals/tax/items to USD, uses the first tag as category, and stamps create fields only on insert', () => {
    const created = write();
    expect(created.storeName).toBe('Costco');
    expect(created.totalAmount).toBe(round2(convertEntryToUsd(138, 'CAD')));
    expect(created.taxAmount).toBe(round2(convertEntryToUsd(13.8, 'CAD')));
    expect(created.category).toBe('Groceries');
    expect(created.categoryTags).toEqual(['Groceries', 'Household']);
    expect(created.notes).toBe('weekly');
    expect(created.paidBy).toBe('u1');
    expect(created.originalCurrency).toBe('CAD');
    expect(created.recurring).toBeNull();
    expect(created.createdBy).toBe('u1');
    expect(created.isRecurringOccurrence).toBe(false);
    expect(created.lineItems).toEqual([
      { id: 'i1', name: 'Milk', amount: round2(convertEntryToUsd(69, 'CAD')), category: 'Groceries', splitWith: [] },
    ]);
    const edited = write({ isNew: false, paidBy: 'u2', tax: '', notes: '   ' });
    expect(edited.createdBy).toBeUndefined();
    expect(edited.createdAt).toBeUndefined();
    expect(edited.taxAmount).toBeNull();
    expect(edited.notes).toBeNull();
    expect(edited.paidBy).toBe('u2');
    expect(edited.updatedAt).toBe('2026-03-05T18:00:00.000Z');
  });

  it('writes the civil date at local noon so the calendar day does not roll with UTC', () => {
    expect(receiptDateIso('2026-03-05')).toBe(new Date(2026, 2, 5, 12).toISOString());
    expect(write().date).toBe(receiptDateIso('2026-03-05'));
  });
});

describe('itemsPlusTaxMismatch', () => {
  it('only warns when items exist and the sum plus tax is off by more than two cents', () => {
    expect(itemsPlusTaxMismatch(0, 0, '', '10')).toBe(false);
    expect(itemsPlusTaxMismatch(2, 9, '1', '10')).toBe(false);
    expect(itemsPlusTaxMismatch(2, 9, '1', '10.05')).toBe(true);
    expect(itemsPlusTaxMismatch(2, 10, '', '0')).toBe(false);
  });
});
