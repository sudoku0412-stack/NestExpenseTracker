import { describe, expect, it } from 'vitest';
import { parseBudgetAmount, unbudgetedCategories } from '../budgetInput';

describe('parseBudgetAmount', () => {
  it('accepts zero so Remove can clear a budget', () => {
    expect(parseBudgetAmount('0')).toBe(0);
    expect(parseBudgetAmount('')).toBe(0);
  });

  it('rejects negatives and non-numbers', () => {
    expect(parseBudgetAmount('-1')).toBeNull();
    expect(parseBudgetAmount('abc')).toBeNull();
    expect(parseBudgetAmount('Infinity')).toBeNull();
  });

  it('accepts a finite amount', () => {
    expect(parseBudgetAmount('12.50')).toBe(12.5);
  });
});

describe('unbudgetedCategories', () => {
  it('treats missing and zero as available, keeps a positive budget out', () => {
    expect(unbudgetedCategories(['Groceries', 'Gas', 'Dining'], { Groceries: 200, Gas: 0 })).toEqual([
      'Gas',
      'Dining',
    ]);
  });
});
