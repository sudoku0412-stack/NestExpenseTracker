import { describe, expect, it } from 'vitest';
import { formatDisplayMoney } from '../displayMoney';

describe('formatDisplayMoney', () => {
  it('groups thousands and keeps the currency prefix', () => {
    expect(formatDisplayMoney(1234.5, 'USD')).toBe('$1,234.50');
    // INR is USD-canonical × 83.3, no decimals: 20 → 1,666
    expect(formatDisplayMoney(20, 'INR')).toBe('₹1,666');
    // CHF prefix is alphabetic ("CHF "), 1234.5 USD → 1,086.36
    expect(formatDisplayMoney(1234.5, 'CHF')).toBe('CHF 1,086.36');
  });

  it('prefixes a non-wrapping minus for negatives', () => {
    expect(formatDisplayMoney(-20, 'USD')).toBe('\u2212$20.00');
    expect(formatDisplayMoney(0, 'USD')).toBe('$0.00');
  });
});
