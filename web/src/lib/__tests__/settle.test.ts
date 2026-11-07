import { describe, expect, it } from 'vitest';
import { settleAmountUsd, settlementParties } from '../settle';

describe('settlementParties', () => {
  it('records them paying you when the net is in your favour', () => {
    expect(settlementParties('me', 'bob', 40)).toEqual({ fromUid: 'bob', toUid: 'me' });
  });

  it('records you paying them when you owe', () => {
    expect(settlementParties('me', 'bob', -12.5)).toEqual({ fromUid: 'me', toUid: 'bob' });
  });
});

describe('settleAmountUsd', () => {
  it('uses the whole net when the amount field is empty', () => {
    expect(settleAmountUsd('', -20, 'USD')).toBe(20);
    expect(settleAmountUsd(undefined, 15, 'USD')).toBe(15);
  });

  it('converts a typed CAD amount into USD', () => {
    expect(settleAmountUsd('13.80', 100, 'CAD')).toBeCloseTo(10, 5);
  });

  it('does not treat garbage text as a payment', () => {
    expect(settleAmountUsd('nope', 40, 'USD')).toBeNaN();
  });
});
