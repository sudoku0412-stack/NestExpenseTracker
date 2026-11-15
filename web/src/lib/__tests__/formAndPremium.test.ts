import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM, MAX_NAME, normalizeCategoryName, validateCustomCategoryName } from '../customCategory';
import { incomeFormError, receiptFormError } from '../formValidation';
import { promoGrantsPremium } from '../premiumGrant';

describe('receiptFormError', () => {
  const base = {
    store: 'Aldi',
    total: 20,
    tags: ['Groceries'],
    items: [] as { name: string; amount: string }[],
    splitOn: false,
    people: [] as string[],
    method: 'equal' as const,
    vals: {} as Record<string, string>,
  };
  it('requires store, positive total, and at least one tag', () => {
    expect(receiptFormError({ ...base, store: '  ' })).toBe('Enter the store name.');
    expect(receiptFormError({ ...base, total: 0 })).toBe('Enter a total greater than zero.');
    expect(receiptFormError({ ...base, tags: [] })).toBe('Pick at least one category.');
  });
  it('rejects blank or non-numeric line items, including zero amounts', () => {
    expect(receiptFormError({ ...base, items: [{ name: '', amount: '1' }] })).toBe('Each item needs a name and an amount.');
    expect(receiptFormError({ ...base, items: [{ name: 'Milk', amount: '0' }] })).toBe('Each item needs a name and an amount.');
  });
  it('validates split participants and method totals', () => {
    expect(receiptFormError({ ...base, splitOn: true, people: ['a'] })).toBe('Choose at least two people to split with.');
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'percent', vals: { a: '40', b: '50' } })).toBe(
      'Percentages must add up to 100.',
    );
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'amount', vals: { a: '5', b: '5' } })).toBe(
      'Amounts must add up to the total.',
    );
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'shares', vals: { a: '0', b: '0' } })).toBe(
      'Give at least one person a share.',
    );
    expect(receiptFormError({ ...base, splitOn: true, people: ['a', 'b'], method: 'equal' })).toBeNull();
  });
});

describe('incomeFormError', () => {
  it('requires source, amount, and earner', () => {
    expect(incomeFormError('  ', 10, 'u')).toBe('Enter where the money came from.');
    expect(incomeFormError('Job', 0, 'u')).toBe('Enter an amount greater than zero.');
    expect(incomeFormError('Job', 10, '')).toBe('Choose who earned it.');
    expect(incomeFormError('Job', 10, 'u')).toBeNull();
  });
});

describe('custom categories', () => {
  it('collapses whitespace and rejects duplicates case-insensitively', () => {
    expect(normalizeCategoryName('  Pet   food ')).toBe('Pet food');
    expect(validateCustomCategoryName('groceries', [], ['Groceries'])).toBe('A category with that name already exists.');
    expect(validateCustomCategoryName('Pets', ['pets'], [])).toBe('A category with that name already exists.');
  });
  it('enforces length and household cap', () => {
    expect(validateCustomCategoryName('x'.repeat(MAX_NAME + 1), [], [])).toBe(`Keep it to ${MAX_NAME} characters or fewer.`);
    expect(validateCustomCategoryName('Pets', Array.from({ length: MAX_CUSTOM }, (_, i) => `c${i}`), [])).toBe(
      `You can have up to ${MAX_CUSTOM} custom categories.`,
    );
  });
});

describe('promoGrantsPremium', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  it('is true for grantsPro even with no timestamp', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
  });
  it('is true only while freeUntil is in the future', () => {
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date('2026-07-01Z') } }, now)).toBe(true);
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date('2026-05-01Z') } }, now)).toBe(false);
  });
  it('is false for an empty promo doc', () => {
    expect(promoGrantsPremium({}, now)).toBe(false);
  });
});
