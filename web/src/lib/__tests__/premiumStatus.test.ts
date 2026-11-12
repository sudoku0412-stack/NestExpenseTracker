import { describe, expect, it } from 'vitest';
import { combinePremium, promoIsActive } from '../premiumStatus';

describe('promoIsActive', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');

  it('is true for grantsPro even without a freeUntil date', () => {
    expect(promoIsActive({ grantsPro: true }, now)).toBe(true);
  });

  it('is true while freeUntil is in the future and false once it lapses', () => {
    const until = (iso: string) => ({ toDate: () => new Date(iso) });
    expect(promoIsActive({ freeUntil: until('2026-07-01T00:00:00Z') }, now)).toBe(true);
    expect(promoIsActive({ freeUntil: until('2026-05-01T00:00:00Z') }, now)).toBe(false);
  });

  it('ignores missing docs and grantsPro that is not strictly true', () => {
    expect(promoIsActive(undefined, now)).toBe(false);
    expect(promoIsActive({ grantsPro: 'yes' }, now)).toBe(false);
  });
});

describe('combinePremium', () => {
  it('promo or an active sub is ready+premium', () => {
    expect(combinePremium(true, null)).toEqual({ status: 'ready', premium: true });
    expect(combinePremium(false, true)).toEqual({ status: 'ready', premium: true });
  });

  it('a failed sub check without promo is unavailable, not free', () => {
    expect(combinePremium(false, null)).toEqual({ status: 'unavailable', premium: false });
  });

  it('a definite non-subscriber is ready and free', () => {
    expect(combinePremium(false, false)).toEqual({ status: 'ready', premium: false });
  });
});
