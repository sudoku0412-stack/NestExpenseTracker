import { describe, expect, it } from 'vitest';
import { promoGrantsPremium } from '../premiumGrant';

describe('promoGrantsPremium', () => {
  const now = Date.parse('2026-03-15T12:00:00Z');

  it('is false with no document', () => {
    expect(promoGrantsPremium(undefined, now)).toBe(false);
  });

  it('honours an explicit grantsPro flag even without a date', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
    expect(promoGrantsPremium({ grantsPro: 'true' }, now)).toBe(false);
  });

  it('uses freeUntil when it is still in the future', () => {
    expect(promoGrantsPremium({
      freeUntil: { toDate: () => new Date('2026-03-16T00:00:00Z') },
    }, now)).toBe(true);
    expect(promoGrantsPremium({
      freeUntil: { toDate: () => new Date('2026-03-14T00:00:00Z') },
    }, now)).toBe(false);
  });
});
