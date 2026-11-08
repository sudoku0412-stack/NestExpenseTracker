import { describe, expect, it } from 'vitest';
import { formatGroupedCurrency } from '../moneyDisplay';
import { clampBudgetUsd, roundUsd } from '../writesMoney';

describe('formatGroupedCurrency', () => {
  it('inserts thousands separators without breaking a currency prefix', () => {
    expect(formatGroupedCurrency('$1234.50', 1234.5)).toBe('$1,234.50');
    expect(formatGroupedCurrency('CA$1000.00', 1000)).toBe('CA$1,000.00');
  });

  it('uses a non-wrapping minus for negatives', () => {
    expect(formatGroupedCurrency('$12.00', -12)).toBe('\u2212$12.00');
  });
});

describe('roundUsd / clampBudgetUsd', () => {
  it('rounds to cents', () => {
    expect(roundUsd(10.006)).toBe(10.01);
    expect(roundUsd(10.004)).toBe(10);
  });

  it('never writes a negative budget', () => {
    expect(clampBudgetUsd(-3.2)).toBe(0);
    expect(clampBudgetUsd(12.349)).toBe(12.35);
  });
});
