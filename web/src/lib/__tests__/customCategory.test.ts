import { describe, expect, it } from 'vitest';
import {
  checkCustomCategoryName,
  CUSTOM_CATEGORY_COLORS,
  MAX_CUSTOM_CATEGORIES,
  MAX_CUSTOM_CATEGORY_NAME,
  nextCategoryColor,
} from '../customCategory';

describe('checkCustomCategoryName', () => {
  it('trims and collapses whitespace', () => {
    expect(checkCustomCategoryName('  Pet   Care ', [])).toEqual({ ok: true, name: 'Pet Care' });
  });

  it('rejects empty, too-long, built-in, Recurring, and duplicate names', () => {
    expect(checkCustomCategoryName('   ', []).ok).toBe(false);
    expect(checkCustomCategoryName('x'.repeat(MAX_CUSTOM_CATEGORY_NAME + 1), []).ok).toBe(false);
    expect(checkCustomCategoryName('groceries', []).ok).toBe(false);
    expect(checkCustomCategoryName('Recurring', []).ok).toBe(false);
    expect(checkCustomCategoryName('Pets', [{ name: 'pets' }]).ok).toBe(false);
  });

  it('enforces the per-household cap', () => {
    const existing = Array.from({ length: MAX_CUSTOM_CATEGORIES }, (_, i) => ({ name: `Cat ${i}` }));
    expect(checkCustomCategoryName('One more', existing).ok).toBe(false);
  });
});

describe('nextCategoryColor', () => {
  it('cycles the same palette the phone app uses', () => {
    expect(nextCategoryColor(0)).toBe(CUSTOM_CATEGORY_COLORS[0]);
    expect(nextCategoryColor(CUSTOM_CATEGORY_COLORS.length)).toBe(CUSTOM_CATEGORY_COLORS[0]);
  });
});
