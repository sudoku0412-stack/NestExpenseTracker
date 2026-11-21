import { describe, expect, it } from 'vitest';
import { calendarDateKey } from '@app/lib/calendarDate';
import { convertEntryToUsd } from '@app/lib/currency';
import { receiptStoredDate, round2, storedSplitValues, storedTaxUsd, validateReceiptForm } from '../receiptWrite';

const ok = {
  store: 'Costco',
  total: 100,
  tags: ['Groceries'],
  items: [] as { name: string; amount: number }[],
  splitOn: false,
  people: ['a', 'b'],
  method: 'equal' as const,
  values: {} as Record<string, number>,
};

describe('receiptStoredDate', () => {
  it('keeps the civil day when stored as ISO (noon local, not UTC midnight)', () => {
    expect(calendarDateKey(receiptStoredDate('2026-03-01'))).toBe('2026-03-01');
    expect(new Date(receiptStoredDate('2026-03-01')).getHours()).toBe(12);
    expect(calendarDateKey(receiptStoredDate('2026-12-31'))).toBe('2026-12-31');
  });
});

describe('validateReceiptForm', () => {
  it('rejects empty store, non-positive total, no tags, and blank items', () => {
    expect(validateReceiptForm({ ...ok, store: '  ' })).toBe('Enter the store name.');
    expect(validateReceiptForm({ ...ok, total: 0 })).toBe('Enter a total greater than zero.');
    expect(validateReceiptForm({ ...ok, tags: [] })).toBe('Pick at least one category.');
    expect(validateReceiptForm({ ...ok, items: [{ name: '', amount: 1 }] })).toBe('Each item needs a name and an amount.');
    expect(validateReceiptForm({ ...ok, items: [{ name: 'Milk', amount: 0 }] })).toBe('Each item needs a name and an amount.');
    expect(validateReceiptForm(ok)).toBeNull();
  });

  it('allows a negative item amount (discounts) but not NaN', () => {
    expect(validateReceiptForm({ ...ok, items: [{ name: 'Coupon', amount: -2 }] })).toBeNull();
    expect(validateReceiptForm({ ...ok, items: [{ name: 'X', amount: Number.NaN }] })).toBe('Each item needs a name and an amount.');
  });

  it('enforces split participant and method totals', () => {
    expect(validateReceiptForm({ ...ok, splitOn: true, people: ['a'] })).toBe('Choose at least two people to split with.');
    expect(validateReceiptForm({ ...ok, splitOn: true, method: 'percent', values: { a: 40, b: 50 } })).toBe('Percentages must add up to 100.');
    expect(validateReceiptForm({ ...ok, splitOn: true, method: 'amount', values: { a: 40, b: 50 } })).toBe('Amounts must add up to the total.');
    expect(validateReceiptForm({ ...ok, splitOn: true, method: 'shares', values: { a: 0, b: 0 } })).toBe('Give at least one person a share.');
    expect(validateReceiptForm({ ...ok, splitOn: true, method: 'percent', values: { a: 40, b: 60 } })).toBeNull();
    expect(validateReceiptForm({ ...ok, splitOn: true, method: 'amount', values: { a: 40, b: 60 } })).toBeNull();
    expect(validateReceiptForm({ ...ok, splitOn: true, method: 'shares', values: { a: 2, b: 0 } })).toBeNull();
  });
});

describe('stored tax and split values', () => {
  it('drops empty or non-positive tax, and converts CAD tax to USD', () => {
    expect(storedTaxUsd('', 'USD')).toBeNull();
    expect(storedTaxUsd('0', 'USD')).toBeNull();
    expect(storedTaxUsd('1.38', 'CAD')).toBe(round2(convertEntryToUsd(1.38, 'CAD')));
  });

  it('converts amount-splits to USD but leaves share counts in entry units', () => {
    const amount = storedSplitValues('amount', ['a', 'b'], { a: 69, b: 69 }, 'CAD');
    expect(amount?.values?.a).toBe(round2(convertEntryToUsd(69, 'CAD')));
    expect(amount?.values?.b).toBe(round2(convertEntryToUsd(69, 'CAD')));
    const shares = storedSplitValues('shares', ['a', 'b'], { a: 2, b: 1 }, 'CAD');
    expect(shares?.values).toEqual({ a: 2, b: 1 });
    expect(storedSplitValues('equal', ['a', 'b'], {}, 'USD')?.values).toBeUndefined();
  });
});
