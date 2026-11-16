import { describe, expect, it } from 'vitest';
import { roundBudgetUsd, roundUsd } from '../moneyRound';

describe('roundUsd / roundBudgetUsd', () => {
  it('rounds to cents the way Firestore writes do', () => {
    expect(roundUsd(1.234)).toBe(1.23);
    expect(roundUsd(1.236)).toBe(1.24);
    expect(roundUsd(-1.236)).toBe(-1.24);
  });

  it('clamps a budget at zero so a deleted category writes 0 not a negative', () => {
    expect(roundBudgetUsd(-3.5)).toBe(0);
    expect(roundBudgetUsd(12.344)).toBe(12.34);
  });
});
