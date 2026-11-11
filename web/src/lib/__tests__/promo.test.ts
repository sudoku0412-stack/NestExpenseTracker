import { describe, expect, it } from 'vitest';
import { promoGrantsPremium } from '../promo';

describe('promoGrantsPremium', () => {
  const now = Date.parse('2026-03-15T12:00:00Z');

  it('is false with no redemption doc', () => {
    expect(promoGrantsPremium(undefined, now)).toBe(false);
  });

  it('trusts grantsPro even without an expiry', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
    expect(promoGrantsPremium({ grantsPro: 'true' }, now)).toBe(false);
  });

  it('honors freeUntil from a Firestore Timestamp-like object', () => {
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date('2026-03-16T00:00:00Z') } }, now)).toBe(true);
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date('2026-03-14T00:00:00Z') } }, now)).toBe(false);
    expect(promoGrantsPremium({ freeUntil: null }, now)).toBe(false);
  });
});
