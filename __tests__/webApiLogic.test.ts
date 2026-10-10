import {
  extractJsonObject,
  isPremiumEntitlement,
  MAX_IMAGE_BYTES,
  premiumFromSubscriber,
  receiptImageError,
} from '../workers/web-api/src/logic';

const now = Date.parse('2026-10-10T12:00:00.000Z');

describe('premiumFromSubscriber', () => {
  it('lifetime (null expiry) and a still-valid expiry are Premium', () => {
    expect(isPremiumEntitlement({ expires_date: null }, now)).toBe(true);
    expect(isPremiumEntitlement({ expires_date: '2026-10-11T00:00:00Z' }, now)).toBe(true);
  });

  it('missing entitlement or an expired date is not Premium', () => {
    expect(isPremiumEntitlement(undefined, now)).toBe(false);
    expect(isPremiumEntitlement({ expires_date: '2026-10-09T00:00:00Z' }, now)).toBe(false);
    expect(premiumFromSubscriber({ subscriber: { entitlements: { something_else: { expires_date: null } } } }, now)).toBe(false);
    expect(premiumFromSubscriber({ subscriber: { entitlements: { premium: { expires_date: null } } } }, now)).toBe(true);
  });
});

describe('receiptImageError / extractJsonObject', () => {
  it('accepts png/jpeg/webp data URLs and rejects other schemes', () => {
    expect(receiptImageError('data:image/png;base64,abcd')).toBeNull();
    expect(receiptImageError('data:image/jpeg;base64,abcd')).toBeNull();
    expect(receiptImageError('data:image/jpg;base64,abcd')).toBeNull();
    expect(receiptImageError('data:image/webp;base64,abcd')).toBeNull();
    expect(receiptImageError('data:image/gif;base64,abcd')).toBe('format');
    expect(receiptImageError('https://cdn.example/r.png')).toBe('format');
  });

  it('rejects images over the 6MB decoded-size cap', () => {
    const tooBig = `data:image/png;base64,${'A'.repeat(Math.floor(MAX_IMAGE_BYTES / 0.75) + 10)}`;
    expect(receiptImageError(tooBig)).toBe('size');
  });

  it('pulls the first JSON object out of model prose', () => {
    expect(extractJsonObject('Sure.\n{"storeName":"Costco","totalAmount":12}\n')).toBe('{"storeName":"Costco","totalAmount":12}');
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('}{')).toBeNull();
  });
});
