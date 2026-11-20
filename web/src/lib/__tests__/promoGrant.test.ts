import { describe, expect, it } from 'vitest';
import { promoIsActive } from '../promoGrant';

describe('promoIsActive', () => {
  const now = Date.parse('2026-11-20T13:00:00Z');

  it('is false with no document', () => {
    expect(promoIsActive(undefined, now)).toBe(false);
  });
  it('is true for a lifetime grantsPro flag even without a date', () => {
    expect(promoIsActive({ grantsPro: true }, now)).toBe(true);
  });
  it('does not treat a string true as a grant', () => {
    expect(promoIsActive({ grantsPro: 'true' }, now)).toBe(false);
  });
  it('is true while freeUntil is in the future and false once it has passed', () => {
    const future = { toDate: () => new Date('2026-12-01T00:00:00Z') };
    const past = { toDate: () => new Date('2026-01-01T00:00:00Z') };
    expect(promoIsActive({ grantsPro: false, freeUntil: future }, now)).toBe(true);
    expect(promoIsActive({ grantsPro: false, freeUntil: past }, now)).toBe(false);
  });
});
