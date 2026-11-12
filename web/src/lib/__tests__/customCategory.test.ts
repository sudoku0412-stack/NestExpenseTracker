import { describe, expect, it } from 'vitest';
import { CATEGORY_COLORS, MAX_CUSTOM, nextCategoryColor, normalizeCategoryName, validateCustomCategory } from '../customCategory';

describe('custom categories', () => {
  it('collapses inner whitespace', () => {
    expect(normalizeCategoryName('  Pet   food ')).toBe('Pet food');
  });

  it('rejects empty, over-long, duplicate (case-insensitive), and over-capacity names', () => {
    expect(validateCustomCategory('   ', [], [])).toBe('Enter a name.');
    expect(validateCustomCategory('x'.repeat(25), [], [])).toContain('24 characters');
    expect(validateCustomCategory('Groceries', [], ['Groceries'])).toBe('A category with that name already exists.');
    expect(validateCustomCategory('pets', ['Pets'], [])).toBe('A category with that name already exists.');
    expect(validateCustomCategory('New', Array.from({ length: MAX_CUSTOM }, (_, i) => `c${i}`), [])).toContain(
      `${MAX_CUSTOM} custom categories`,
    );
  });

  it('cycles colours', () => {
    expect(nextCategoryColor(0)).toBe(CATEGORY_COLORS[0]);
    expect(nextCategoryColor(CATEGORY_COLORS.length)).toBe(CATEGORY_COLORS[0]);
  });
});
