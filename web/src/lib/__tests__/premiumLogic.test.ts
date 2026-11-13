import { describe, expect, it } from 'vitest';
import { premiumGateKind, promoGrantsPremium } from '../premiumLogic';

describe('promoGrantsPremium', () => {
  const now = Date.parse('2026-03-15T12:00:00Z');

  it('is false with no redemption doc', () => {
    expect(promoGrantsPremium(undefined, now)).toBe(false);
  });

  it('is true for a permanent grantsPro flag even with no expiry', () => {
    expect(promoGrantsPremium({ grantsPro: true }, now)).toBe(true);
  });

  it('does not treat a truthy non-boolean grantsPro as Premium', () => {
    expect(promoGrantsPremium({ grantsPro: 'yes' }, now)).toBe(false);
  });

  it('is true while freeUntil is still in the future, and false once it has passed', () => {
    const future = { toDate: () => new Date('2026-04-01T00:00:00Z') };
    const past = { toDate: () => new Date('2026-03-01T00:00:00Z') };
    expect(promoGrantsPremium({ grantsPro: false, freeUntil: future }, now)).toBe(true);
    expect(promoGrantsPremium({ grantsPro: false, freeUntil: past }, now)).toBe(false);
  });
});

describe('premiumGateKind', () => {
  it('shows content whenever Premium is already true, even if the sub check failed', () => {
    expect(premiumGateKind('unavailable', true)).toBe('content');
    expect(premiumGateKind('loading', true)).toBe('content');
  });

  it('shows loading, then the upgrade card or an unavailable note', () => {
    expect(premiumGateKind('loading', false)).toBe('loading');
    expect(premiumGateKind('unavailable', false)).toBe('unavailable');
    expect(premiumGateKind('ready', false)).toBe('upgrade');
  });
});
