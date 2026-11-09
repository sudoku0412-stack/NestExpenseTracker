import { describe, expect, it } from 'vitest';
import { ALL_CATEGORIES } from '@app/constants/categories';
import {
  clampBudgetUsd,
  cleanCategoryName,
  MAX_CUSTOM,
  MAX_NAME,
  nextCustomColor,
  roundUsd,
  validateCustomCategory,
} from '../customCategoryForm';
import { remapSelfId, remapSelfIds, remapSelfRecord } from '../splitSelf';

describe('validateCustomCategory', () => {
  const builtins = ALL_CATEGORIES as string[];

  it('trims and collapses whitespace', () => {
    expect(cleanCategoryName('  Pet   Care ')).toBe('Pet Care');
    expect(validateCustomCategory('  Pet   Care ', [], builtins)).toEqual({ ok: true, clean: 'Pet Care' });
  });

  it('rejects empty, too-long, built-in, and duplicate names (case-insensitive)', () => {
    expect(validateCustomCategory('   ', [], builtins)).toEqual({ ok: false, reason: 'empty' });
    expect(validateCustomCategory('x'.repeat(MAX_NAME + 1), [], builtins)).toEqual({ ok: false, reason: 'tooLong' });
    expect(validateCustomCategory('groceries', [], builtins)).toEqual({ ok: false, reason: 'duplicate' });
    expect(validateCustomCategory('Pets', ['pets'], builtins)).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('enforces the per-household cap before adding another', () => {
    const existing = Array.from({ length: MAX_CUSTOM }, (_, i) => `Cat ${i}`);
    expect(validateCustomCategory('One more', existing, builtins)).toEqual({ ok: false, reason: 'limit' });
  });

  it('cycles palette colours', () => {
    expect(nextCustomColor(0)).toBe('#D6336C');
    expect(nextCustomColor(8)).toBe('#D6336C');
    expect(nextCustomColor(1)).toBe('#0CA678');
  });
});

describe('budget / settlement rounding', () => {
  it('rounds to cents and never writes a negative budget', () => {
    expect(clampBudgetUsd(12.345)).toBe(12.35);
    expect(clampBudgetUsd(-3)).toBe(0);
    expect(roundUsd(10.004)).toBe(10);
    expect(roundUsd(-1.226)).toBe(-1.23);
  });
});

describe('remapSelf', () => {
  it('rewrites the literal self placeholder to the signed-in uid', () => {
    expect(remapSelfId('self', 'u1')).toBe('u1');
    expect(remapSelfId('u2', 'u1')).toBe('u2');
    expect(remapSelfId('self', undefined)).toBe('self');
  });
  it('rewrites participant lists and percent/amount maps so other devices can resolve the split', () => {
    expect(remapSelfIds(['self', 'bob'], 'u1')).toEqual(['u1', 'bob']);
    expect(remapSelfRecord({ self: 40, bob: 60 }, 'u1')).toEqual({ u1: 40, bob: 60 });
  });
});
