import { describe, expect, it } from 'vitest';
import { formatGroupedMoney } from '../displayMoney';

describe('formatGroupedMoney', () => {
  it('inserts thousands separators after the currency prefix', () => {
    expect(formatGroupedMoney(1234.5, '$1234.50')).toBe('$1,234.50');
    expect(formatGroupedMoney(1000000, 'CA$1000000.00')).toBe('CA$1,000,000.00');
  });
  it('uses a non-wrapping minus for negatives', () => {
    expect(formatGroupedMoney(-12.5, '$12.50')).toBe('\u2212$12.50');
    expect(formatGroupedMoney(-1234, '$1234.00')).toBe('\u2212$1,234.00');
  });
  it('leaves zero-decimal amounts without a trailing dot', () => {
    expect(formatGroupedMoney(1234, '₹1234')).toBe('₹1,234');
  });
});
