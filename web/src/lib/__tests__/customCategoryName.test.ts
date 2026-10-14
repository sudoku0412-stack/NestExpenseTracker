import { describe, expect, it } from 'vitest';
import {
  CUSTOM_CATEGORY_COLORS,
  MAX_CUSTOM_CATEGORIES,
  MAX_CUSTOM_CATEGORY_NAME,
  nextCustomCategoryColor,
  validateCustomCategoryName,
} from '../customCategoryName';

describe('validateCustomCategoryName', () => {
  it('trims and collapses inner whitespace', () => {
    expect(validateCustomCategoryName('  Pet   Care ', [])).toEqual({ ok: true, name: 'Pet Care' });
  });

  it('rejects empty, too-long, built-in (any case), Recurring, and duplicate names', () => {
    expect(validateCustomCategoryName('   ', [])).toEqual({ ok: false, error: 'Enter a name.' });
    expect(validateCustomCategoryName('x'.repeat(MAX_CUSTOM_CATEGORY_NAME + 1), [])).toEqual({
      ok: false,
      error: `Keep it to ${MAX_CUSTOM_CATEGORY_NAME} characters or fewer.`,
    });
    expect(validateCustomCategoryName('groceries', [])).toEqual({
      ok: false,
      error: 'A category with that name already exists.',
    });
    expect(validateCustomCategoryName('Recurring', [])).toEqual({
      ok: false,
      error: 'A category with that name already exists.',
    });
    expect(validateCustomCategoryName('Investments', [])).toEqual({
      ok: false,
      error: 'A category with that name already exists.',
    });
    expect(validateCustomCategoryName('pets', [{ name: 'Pets' }])).toEqual({
      ok: false,
      error: 'A category with that name already exists.',
    });
  });

  it('enforces the per-household limit before accepting another name', () => {
    const existing = Array.from({ length: MAX_CUSTOM_CATEGORIES }, (_, i) => ({ name: `Cat ${i}` }));
    expect(validateCustomCategoryName('One more', existing)).toEqual({
      ok: false,
      error: `You can have up to ${MAX_CUSTOM_CATEGORIES} custom categories.`,
    });
  });
});

describe('nextCustomCategoryColor', () => {
  it('cycles the same palette the phone app uses', () => {
    expect(nextCustomCategoryColor(0)).toBe(CUSTOM_CATEGORY_COLORS[0]);
    expect(nextCustomCategoryColor(CUSTOM_CATEGORY_COLORS.length)).toBe(CUSTOM_CATEGORY_COLORS[0]);
    expect(nextCustomCategoryColor(1)).toBe(CUSTOM_CATEGORY_COLORS[1]);
  });
});
