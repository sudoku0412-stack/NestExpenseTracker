import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES } from '@app/constants/categories';
import { MAX_CUSTOM, MAX_NAME, normalizeCategoryName, validateCustomCategoryName } from '../customCategory';
import { incomeFormError, receiptFormError } from '../formValidation';
import { promoGrantsPremium } from '../premiumGrant';

describe('receiptFormError', () => {
  const base = {
    store: 'Aldi',
    total: 40,
    tags: ['Groceries'],
    items: [] as { name: string; amount: string }[],
    splitOn: false,
    people: [] as string[],
    method: 'equal' as const,
    vals: {} as Record<string, string>,
  };

  it('requires a store, a positive total and at least one category', () => {
    expect(receiptFormError({ ...base, store: '  ' })).toBe('Enter the store name.');
    expect(receiptFormError({ ...base, total: 0 })).toBe('Enter a total greater than zero.');
    expect(receiptFormError({ ...base, tags: [] })).toBe('Pick at least one category.');
  });

  it('rejects a nameless or zero-amount line item, but allows a negative discount line', () => {
    expect(receiptFormError({ ...base, items: [{ name: 'Milk', amount: '0' }] })).toBe('Each item needs a name and an amount.');
    expect(receiptFormError({ ...base, items: [{ name: 'Coupon', amount: '-2' }] })).toBeNull();
  });

  it('enforces split participant count, percent sum, amount sum and at least one share', () => {
    expect(receiptFormError({ ...base, splitOn: true, people: ['a'] })).toBe('Choose at least two people to split with.');
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'percent', vals: { a: '40', b: '40' } })).toBe(
      'Percentages must add up to 100.',
    );
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'amount', vals: { a: '10', b: '10' } })).toBe(
      'Amounts must add up to the total.',
    );
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'shares', vals: { a: '0', b: '0' } })).toBe(
      'Give at least one person a share.',
    );
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'equal' })).toBeNull();
  });
});

describe('incomeFormError', () => {
  it('requires source, positive amount and earner', () => {
    expect(incomeFormError('  ', 10, 'u1')).toBe('Enter where the money came from.');
    expect(incomeFormError('Job', 0, 'u1')).toBe('Enter an amount greater than zero.');
    expect(incomeFormError('Job', 10, '')).toBe('Choose who earned it.');
    expect(incomeFormError('Job', 10, 'u1')).toBeNull();
  });
});

describe('validateCustomCategoryName', () => {
  it('trims, rejects empty / too long / duplicates / the cap', () => {
    expect(normalizeCategoryName('  Pet   Care ')).toBe('Pet Care');
    expect(validateCustomCategoryName('  ', [], ALL_CATEGORIES as string[])).toBe('Enter a name.');
    expect(validateCustomCategoryName('x'.repeat(MAX_NAME + 1), [], ALL_CATEGORIES as string[])).toMatch(/Keep it to/);
    expect(validateCustomCategoryName('groceries', [], ALL_CATEGORIES as string[])).toBe('A category with that name already exists.');
    expect(validateCustomCategoryName('Pets', ['pets'], ALL_CATEGORIES as string[])).toBe('A category with that name already exists.');
    expect(validateCustomCategoryName('New', Array.from({ length: MAX_CUSTOM }, (_, i) => `C${i}`), [])).toMatch(/up to/);
    expect(validateCustomCategoryName('Pets', [], ALL_CATEGORIES as string[])).toBeNull();
  });
});

describe('promoGrantsPremium', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  it('grants from grantsPro even without a window', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
  });
  it('grants while freeUntil is in the future and not after', () => {
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date('2026-07-01T00:00:00Z') } }, now)).toBe(true);
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date('2026-05-01T00:00:00Z') } }, now)).toBe(false);
  });
  it('does not treat grantsPro: "true" as a grant', () => {
    expect(promoGrantsPremium({ grantsPro: 'true' }, now)).toBe(false);
  });
});
