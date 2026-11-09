import { describe, expect, it } from 'vitest';
import { promoIsActive, resolvePremiumStatus } from '../premiumStatus';

describe('promoIsActive', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  it('is false with no document', () => {
    expect(promoIsActive(undefined, now)).toBe(false);
    expect(promoIsActive(null, now)).toBe(false);
  });
  it('grants Premium for grantsPro even with no window', () => {
    expect(promoIsActive({ grantsPro: true }, now)).toBe(true);
  });
  it('grants Premium only while freeUntil is in the future', () => {
    expect(promoIsActive({ grantsPro: false, freeUntil: { toDate: () => new Date(now + 1000) } }, now)).toBe(true);
    expect(promoIsActive({ grantsPro: false, freeUntil: { toDate: () => new Date(now - 1000) } }, now)).toBe(false);
  });
  it('does not treat a truthy non-boolean grantsPro as Premium', () => {
    expect(promoIsActive({ grantsPro: 'yes' }, now)).toBe(false);
  });
});

describe('resolvePremiumStatus', () => {
  it('is premium when either promo or subscription is active', () => {
    expect(resolvePremiumStatus(true, false)).toEqual({ status: 'ready', premium: true });
    expect(resolvePremiumStatus(false, true)).toEqual({ status: 'ready', premium: true });
    expect(resolvePremiumStatus(true, null)).toEqual({ status: 'ready', premium: true });
  });
  it('is ready-and-free when RevenueCat says no, unavailable when the check failed', () => {
    expect(resolvePremiumStatus(false, false)).toEqual({ status: 'ready', premium: false });
    expect(resolvePremiumStatus(false, null)).toEqual({ status: 'unavailable', premium: false });
  });
});
