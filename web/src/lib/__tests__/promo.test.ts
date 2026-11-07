import { describe, expect, it } from 'vitest';
import { combinePremium, promoGrantsPremium } from '../promo';

const now = Date.parse('2026-11-07T12:00:00Z');

describe('promoGrantsPremium', () => {
  it('is false with no redemption', () => {
    expect(promoGrantsPremium(undefined, now)).toBe(false);
  });

  it('honors an explicit grantsPro flag', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
    expect(promoGrantsPremium({ grantsPro: 'true' }, now)).toBe(false);
  });

  it('treats freeUntil as active only while it is in the future', () => {
    const future = { toDate: () => new Date(now + 60_000) };
    const past = { toDate: () => new Date(now - 60_000) };
    expect(promoGrantsPremium({ freeUntil: future }, now)).toBe(true);
    expect(promoGrantsPremium({ freeUntil: past }, now)).toBe(false);
  });
});

describe('combinePremium', () => {
  it('is Premium if either promo or the subscription is active', () => {
    expect(combinePremium(true, false)).toEqual({ status: 'ready', premium: true });
    expect(combinePremium(false, true)).toEqual({ status: 'ready', premium: true });
  });

  it('is unavailable when RevenueCat could not be checked and there is no promo', () => {
    expect(combinePremium(false, null)).toEqual({ status: 'unavailable', premium: false });
  });

  it('is free only after a successful non-premium check', () => {
    expect(combinePremium(false, false)).toEqual({ status: 'ready', premium: false });
  });
});
