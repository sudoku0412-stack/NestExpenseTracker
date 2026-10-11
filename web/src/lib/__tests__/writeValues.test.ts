import { describe, expect, it } from 'vitest';
import { clampBudgetUsd, roundUsd, trimOrNull } from '../writeValues';

describe('roundUsd', () => {
  it('rounds to cents the same way every Firestore money write does', () => {
    expect(roundUsd(10.126)).toBe(10.13);
    expect(roundUsd(10.124)).toBe(10.12);
    expect(roundUsd(2.5)).toBe(2.5);
  });
});

describe('clampBudgetUsd', () => {
  it('refuses a negative budget (the app cannot delete a synced category)', () => {
    expect(clampBudgetUsd(-12.5)).toBe(0);
    expect(clampBudgetUsd(19.999)).toBe(20);
  });
});

describe('trimOrNull', () => {
  it('stores blank or whitespace notes as null, not an empty string', () => {
    expect(trimOrNull('  keep  ')).toBe('keep');
    expect(trimOrNull('   ')).toBeNull();
    expect(trimOrNull(undefined)).toBeNull();
    expect(trimOrNull(null)).toBeNull();
  });
});
