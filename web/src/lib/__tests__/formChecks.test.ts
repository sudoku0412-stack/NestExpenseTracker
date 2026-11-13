import { describe, expect, it } from 'vitest';
import { customCategorySaveError, incomeSaveError, normalizeCustomCategoryName, receiptSaveError } from '../formChecks';

const okReceipt = {
  store: 'Costco',
  total: 40,
  tags: ['Groceries'],
  items: [] as { name: string; amount: string }[],
  splitOn: false,
  people: ['a', 'b'],
  method: 'equal' as const,
  vals: {} as Record<string, string>,
};

describe('receiptSaveError', () => {
  it('requires store, positive total and at least one category', () => {
    expect(receiptSaveError({ ...okReceipt, store: '  ' })).toBe('Enter the store name.');
    expect(receiptSaveError({ ...okReceipt, total: 0 })).toBe('Enter a total greater than zero.');
    expect(receiptSaveError({ ...okReceipt, tags: [] })).toBe('Pick at least one category.');
    expect(receiptSaveError(okReceipt)).toBeNull();
  });

  it('rejects blank or non-numeric line items, but allows a discount amount', () => {
    expect(receiptSaveError({ ...okReceipt, items: [{ name: 'Milk', amount: '' }] })).toBe('Each item needs a name and an amount.');
    expect(receiptSaveError({ ...okReceipt, items: [{ name: '  ', amount: '3' }] })).toBe('Each item needs a name and an amount.');
    expect(receiptSaveError({ ...okReceipt, items: [{ name: 'Coupon', amount: '-2.5' }] })).toBeNull();
  });

  it('split: two people, percents to 100, amounts to the total, at least one share', () => {
    expect(receiptSaveError({ ...okReceipt, splitOn: true, people: ['a'] })).toBe('Choose at least two people to split with.');
    expect(receiptSaveError({ ...okReceipt, splitOn: true, method: 'percent', vals: { a: '40', b: '50' } })).toBe(
      'Percentages must add up to 100.',
    );
    expect(receiptSaveError({ ...okReceipt, splitOn: true, method: 'amount', vals: { a: '10', b: '10' } })).toBe(
      'Amounts must add up to the total.',
    );
    expect(receiptSaveError({ ...okReceipt, splitOn: true, method: 'shares', vals: { a: '0', b: '0' } })).toBe(
      'Give at least one person a share.',
    );
    expect(receiptSaveError({ ...okReceipt, splitOn: true, method: 'percent', vals: { a: '40', b: '60' } })).toBeNull();
  });
});

describe('incomeSaveError', () => {
  it('requires source, positive amount and earner', () => {
    expect(incomeSaveError('  ', 100, 'u1')).toBe('Enter where the money came from.');
    expect(incomeSaveError('Payroll', 0, 'u1')).toBe('Enter an amount greater than zero.');
    expect(incomeSaveError('Payroll', 100, '')).toBe('Choose who earned it.');
    expect(incomeSaveError('Payroll', 100, 'u1')).toBeNull();
  });
});

describe('customCategorySaveError', () => {
  it('trims, caps length and uniqueness against built-ins', () => {
    expect(normalizeCustomCategoryName('  Pet   food ')).toBe('Pet food');
    expect(customCategorySaveError('  ', [], ['Groceries'])).toBe('Enter a name.');
    expect(customCategorySaveError('x'.repeat(25), [], [])).toMatch(/24 characters/);
    expect(customCategorySaveError('groceries', [], ['Groceries'])).toBe('A category with that name already exists.');
    expect(customCategorySaveError('Pets', ['Pets'], ['Groceries'])).toBe('A category with that name already exists.');
    expect(customCategorySaveError('Pets', [], ['Groceries'])).toBeNull();
  });

  it('caps at 20 custom categories', () => {
    const existing = Array.from({ length: 20 }, (_, i) => `Cat ${i}`);
    expect(customCategorySaveError('New', existing, [])).toMatch(/up to 20/);
  });
});
