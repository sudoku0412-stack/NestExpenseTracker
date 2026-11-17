import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES } from '@app/constants/categories';
import {
  MAX_CUSTOM_CATEGORIES,
  MAX_CUSTOM_CATEGORY_NAME,
  customCategoryError,
  normalizeCustomCategoryName,
} from '../customCategory';

describe('normalizeCustomCategoryName', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeCustomCategoryName('  Pet   Care ')).toBe('Pet Care');
  });
});

describe('customCategoryError', () => {
  const builtins = ALL_CATEGORIES as string[];

  it('rejects empty, too-long, built-in, Recurring, and duplicate names', () => {
    expect(customCategoryError('', [], builtins)).toBe('Enter a name.');
    expect(customCategoryError('x'.repeat(MAX_CUSTOM_CATEGORY_NAME + 1), [], builtins))
      .toBe(`Keep it to ${MAX_CUSTOM_CATEGORY_NAME} characters or fewer.`);
    expect(customCategoryError('groceries', [], builtins)).toBe('A category with that name already exists.');
    expect(customCategoryError('Recurring', [], builtins)).toBe('A category with that name already exists.');
    expect(customCategoryError('Pets', ['pets'], builtins)).toBe('A category with that name already exists.');
  });

  it('enforces the per-household limit', () => {
    const existing = Array.from({ length: MAX_CUSTOM_CATEGORIES }, (_, i) => `Cat ${i}`);
    expect(customCategoryError('One more', existing, builtins))
      .toBe(`You can have up to ${MAX_CUSTOM_CATEGORIES} custom categories.`);
  });

  it('accepts a unique name', () => {
    expect(customCategoryError('Pets', ['Gym'], builtins)).toBeNull();
  });
});
