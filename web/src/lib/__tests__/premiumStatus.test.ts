import { describe, expect, it } from 'vitest';
import { premiumFromChecks, promoGrantActive } from '../premiumStatus';

const now = Date.parse('2026-11-08T12:00:00Z');

describe('promoGrantActive', () => {
  it('treats grantsPro as Premium even without a freeUntil date', () => {
    expect(promoGrantActive({ grantsPro: true, freeUntil: null }, now)).toBe(true);
  });

  it('treats a future Timestamp as Premium and an expired one as not', () => {
    expect(promoGrantActive({ grantsPro: false, freeUntil: { toDate: () => new Date(now + 1000) } }, now)).toBe(true);
    expect(promoGrantActive({ grantsPro: false, freeUntil: { toDate: () => new Date(now - 1000) } }, now)).toBe(false);
  });

  it('is false when the promo doc is missing', () => {
    expect(promoGrantActive(undefined, now)).toBe(false);
  });
});

describe('premiumFromChecks', () => {
  it('promo or an active subscription is Premium and ready', () => {
    expect(premiumFromChecks(true, null)).toEqual({ status: 'ready', premium: true });
    expect(premiumFromChecks(false, true)).toEqual({ status: 'ready', premium: true });
  });

  it('a failed worker check without a promo is unavailable, not free-looking-ready', () => {
    expect(premiumFromChecks(false, null)).toEqual({ status: 'unavailable', premium: false });
  });

  it('an explicit non-premium answer is ready and locked', () => {
    expect(premiumFromChecks(false, false)).toEqual({ status: 'ready', premium: false });
  });
});
