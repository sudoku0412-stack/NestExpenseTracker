import { describe, expect, it } from 'vitest';
import { CUSTOM_COLORS, MAX_CUSTOM, MAX_NAME, validateCustomCategory } from '../customCategory';

describe('validateCustomCategory', () => {
  it('trims, collapses spaces, and cycles the palette', () => {
    expect(validateCustomCategory('  Pet   Care ', [])).toEqual({
      ok: true,
      name: 'Pet Care',
      color: CUSTOM_COLORS[0],
    });
    expect(validateCustomCategory('Gym', [{ name: 'Pets' }])).toMatchObject({ ok: true, color: CUSTOM_COLORS[1] });
  });

  it('rejects empty, too-long, built-in, Recurring, and duplicate names', () => {
    expect(validateCustomCategory('   ', []).ok).toBe(false);
    expect(validateCustomCategory('x'.repeat(MAX_NAME + 1), []).ok).toBe(false);
    expect(validateCustomCategory('groceries', [])).toEqual({ ok: false, error: 'A category with that name already exists.' });
    expect(validateCustomCategory('Recurring', []).ok).toBe(false);
    expect(validateCustomCategory('pets', [{ name: 'Pets' }]).ok).toBe(false);
  });

  it('enforces the per-household cap', () => {
    const existing = Array.from({ length: MAX_CUSTOM }, (_, i) => ({ name: `Cat ${i}` }));
    expect(validateCustomCategory('One more', existing).ok).toBe(false);
  });
});
