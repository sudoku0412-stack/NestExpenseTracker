import { describe, expect, it } from 'vitest';
import { MAX_CUSTOM, MAX_NAME, validateCustomCategory } from '../customCategoryForm';

describe('validateCustomCategory', () => {
  it('trims and collapses whitespace, then assigns the next palette color', () => {
    expect(validateCustomCategory('  Pet   Care ', [{ name: 'Gym' }])).toEqual({
      ok: true,
      name: 'Pet Care',
      color: '#0CA678',
    });
  });

  it('rejects empty, too-long, built-in, Recurring, and duplicate names', () => {
    expect(validateCustomCategory('   ', [])).toEqual({ ok: false, error: 'Enter a name.' });
    expect(validateCustomCategory('x'.repeat(MAX_NAME + 1), [])).toEqual({
      ok: false,
      error: `Keep it to ${MAX_NAME} characters or fewer.`,
    });
    expect(validateCustomCategory('groceries', [])).toEqual({ ok: false, error: 'A category with that name already exists.' });
    expect(validateCustomCategory('Recurring', [])).toEqual({ ok: false, error: 'A category with that name already exists.' });
    expect(validateCustomCategory('Pets', [{ name: 'pets' }])).toEqual({
      ok: false,
      error: 'A category with that name already exists.',
    });
  });

  it('enforces the per-household limit', () => {
    const existing = Array.from({ length: MAX_CUSTOM }, (_, i) => ({ name: `Cat ${i}` }));
    expect(validateCustomCategory('One too many', existing)).toEqual({
      ok: false,
      error: `You can have up to ${MAX_CUSTOM} custom categories.`,
    });
  });
});
