import { describe, expect, it } from 'vitest';
import { settlementAmountUsd, settlementParties } from '../settle';

describe('settlementParties', () => {
  it('records them paying you when they owe you', () => {
    expect(settlementParties('me', 'them', 40)).toEqual({ fromUid: 'them', toUid: 'me' });
  });

  it('records you paying them when you owe them', () => {
    expect(settlementParties('me', 'them', -12.5)).toEqual({ fromUid: 'me', toUid: 'them' });
  });
});

describe('settlementAmountUsd', () => {
  it('uses the outstanding balance when the field is empty', () => {
    expect(settlementAmountUsd(undefined, -40, (n) => n * 2)).toBe(40);
    expect(settlementAmountUsd('', 12, (n) => n)).toBe(12);
  });

  it('converts a typed display-currency amount', () => {
    expect(settlementAmountUsd('10', 99, (n) => n / 2)).toBe(5);
  });
});
