import { describe, expect, it } from 'vitest';
import { premiumFromChecks, promoGrantsPremium } from '../premiumStatus';

const now = Date.parse('2026-10-10T12:00:00.000Z');

describe('promoGrantsPremium', () => {
  it('is true for a permanent grant or an unexpired freeUntil', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
    expect(promoGrantsPremium({ freeUntil: { toDate: () => new Date(now + 60_000) } }, now)).toBe(true);
  });

  it('is false when missing, expired, or grantsPro is not exactly true', () => {
    expect(promoGrantsPremium(undefined, now)).toBe(false);
    expect(promoGrantsPremium({ grantsPro: false, freeUntil: { toDate: () => new Date(now - 1) } }, now)).toBe(false);
    expect(promoGrantsPremium({ grantsPro: 'yes' as unknown as boolean }, now)).toBe(false);
  });
});

describe('premiumFromChecks', () => {
  it('promo or an active subscription is Premium', () => {
    expect(premiumFromChecks(true, false)).toEqual({ status: 'ready', premium: true });
    expect(premiumFromChecks(false, true)).toEqual({ status: 'ready', premium: true });
    expect(premiumFromChecks(true, null)).toEqual({ status: 'ready', premium: true });
  });

  it('a failed RevenueCat check is unavailable only when promo is also off', () => {
    expect(premiumFromChecks(false, null)).toEqual({ status: 'unavailable', premium: false });
    expect(premiumFromChecks(false, false)).toEqual({ status: 'ready', premium: false });
  });
});
