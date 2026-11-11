import { describe, expect, it } from 'vitest';
import { budgetAmountUsd, incomeSaveError, receiptSaveError, roundUsd2, storedSplit } from '../formValidate';

const ok = {
  store: 'Costco',
  total: 40,
  tags: ['Groceries'],
  items: [] as { name: string; amount: string }[],
  splitOn: false,
  method: 'equal' as const,
  people: ['a', 'b'],
  vals: {} as Record<string, string>,
};

describe('receiptSaveError', () => {
  it('rejects empty store, non-positive total, and no categories', () => {
    expect(receiptSaveError({ ...ok, store: '  ' })).toBe('Enter the store name.');
    expect(receiptSaveError({ ...ok, total: 0 })).toBe('Enter a total greater than zero.');
    expect(receiptSaveError({ ...ok, tags: [] })).toBe('Pick at least one category.');
  });

  it('allows discount line items (negative) but not zero or NaN amounts', () => {
    expect(receiptSaveError({ ...ok, items: [{ name: 'Milk', amount: '-1.5' }] })).toBeNull();
    expect(receiptSaveError({ ...ok, items: [{ name: 'Milk', amount: '0' }] })).toBe('Each item needs a name and an amount.');
    expect(receiptSaveError({ ...ok, items: [{ name: '  ', amount: '3' }] })).toBe('Each item needs a name and an amount.');
  });

  it('requires two people and a complete percent / amount / shares split', () => {
    expect(receiptSaveError({ ...ok, splitOn: true, people: ['a'] })).toBe('Choose at least two people to split with.');
    expect(receiptSaveError({ ...ok, splitOn: true, method: 'percent', vals: { a: '40', b: '50' } })).toBe('Percentages must add up to 100.');
    expect(receiptSaveError({ ...ok, splitOn: true, method: 'amount', vals: { a: '10', b: '10' } })).toBe('Amounts must add up to the total.');
    expect(receiptSaveError({ ...ok, splitOn: true, method: 'shares', vals: { a: '0', b: '0' } })).toBe('Give at least one person a share.');
    expect(receiptSaveError({ ...ok, splitOn: true, method: 'percent', vals: { a: '40', b: '60' } })).toBeNull();
  });
});

describe('storedSplit', () => {
  it('omits values for an equal split and converts amount splits to USD cents', () => {
    expect(storedSplit('equal', ['a', 'b'], {}, 'USD').values).toBeUndefined();
    expect(storedSplit('amount', ['a', 'b'], { a: '10.126', b: '29.994' }, 'USD').values).toEqual({ a: 10.13, b: 29.99 });
  });
});

describe('incomeSaveError', () => {
  it('requires source, a positive amount, and who earned it', () => {
    expect(incomeSaveError('  ', 10, 'u')).toBe('Enter where the money came from.');
    expect(incomeSaveError('Job', 0, 'u')).toBe('Enter an amount greater than zero.');
    expect(incomeSaveError('Job', 10, '')).toBe('Choose who earned it.');
    expect(incomeSaveError('Job', 10, 'u')).toBeNull();
  });
});

describe('money rounding used on write', () => {
  it('rounds to cents and never stores a negative category budget', () => {
    expect(roundUsd2(1.234)).toBe(1.23);
    expect(roundUsd2(1.236)).toBe(1.24);
    expect(budgetAmountUsd(-12.3)).toBe(0);
    expect(budgetAmountUsd(19.999)).toBe(20);
  });
});
