import { describe, expect, it } from 'vitest';
import {
  MAX_CUSTOM_CATEGORIES,
  nextCustomCategoryColor,
  validateCustomCategoryName,
} from '../customCategory';

const builtins = ['Groceries', 'Dining'] as const;

describe('validateCustomCategoryName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(validateCustomCategoryName('  Pet   food  ', [], builtins)).toEqual({ ok: true, clean: 'Pet food' });
  });
  it('rejects a blank name', () => {
    expect(validateCustomCategoryName('   ', [], builtins).ok).toBe(false);
  });
  it('rejects names longer than 24 characters', () => {
    expect(validateCustomCategoryName('a'.repeat(25), [], builtins).ok).toBe(false);
  });
  it('rejects a duplicate of a built-in or existing name, ignoring case', () => {
    expect(validateCustomCategoryName('groceries', [], builtins)).toMatchObject({ ok: false });
    expect(validateCustomCategoryName('Pets', ['pets'], builtins)).toMatchObject({ ok: false });
  });
  it('rejects a 21st custom category', () => {
    const existing = Array.from({ length: MAX_CUSTOM_CATEGORIES }, (_, i) => `Cat ${i}`);
    expect(validateCustomCategoryName('New', existing, builtins).ok).toBe(false);
  });
});

describe('nextCustomCategoryColor', () => {
  it('cycles the same eight colours as the mobile app', () => {
    expect(nextCustomCategoryColor(0)).toBe('#D6336C');
    expect(nextCustomCategoryColor(8)).toBe('#D6336C');
    expect(nextCustomCategoryColor(1)).toBe('#0CA678');
  });
});
