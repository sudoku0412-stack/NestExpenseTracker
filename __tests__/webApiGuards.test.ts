import {
  MAX_IMAGE_BYTES,
  bearerToken,
  checkImageDataUrl,
  claimsAreValid,
  corsHeaders,
  entitlementActive,
  extractJsonObject,
} from '../workers/web-api/src/guards';

const project = 'balancesheet-android';
const now = 1_700_000_000;
const validClaims = {
  aud: project,
  iss: `https://securetoken.google.com/${project}`,
  exp: now + 60,
  sub: 'uid-1',
};

describe('corsHeaders', () => {
  const allowed = 'https://nestexpensetracker.craftloop.ca,https://nestexpensetracker-web.pages.dev,http://localhost:5173';

  it('echoes an allowed Origin and falls back to the first allow-list entry', () => {
    expect(corsHeaders('https://nestexpensetracker-web.pages.dev', allowed)['Access-Control-Allow-Origin']).toBe(
      'https://nestexpensetracker-web.pages.dev',
    );
    expect(corsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin']).toBe(
      'https://nestexpensetracker.craftloop.ca',
    );
  });
});

describe('bearerToken / claimsAreValid', () => {
  it('strips a Bearer prefix case-insensitively', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken(null)).toBe('');
  });

  it('rejects the wrong alg, audience, issuer, expiry, or empty sub', () => {
    expect(claimsAreValid({ alg: 'none' }, validClaims, project, now)).toBe(false);
    expect(claimsAreValid({ alg: 'RS256' }, { ...validClaims, aud: 'other' }, project, now)).toBe(false);
    expect(claimsAreValid({ alg: 'RS256' }, { ...validClaims, iss: 'https://evil' }, project, now)).toBe(false);
    expect(claimsAreValid({ alg: 'RS256' }, { ...validClaims, exp: now - 1 }, project, now)).toBe(false);
    expect(claimsAreValid({ alg: 'RS256' }, { ...validClaims, sub: '' }, project, now)).toBe(false);
    expect(claimsAreValid({ alg: 'RS256' }, validClaims, project, now)).toBe(true);
  });
});

describe('checkImageDataUrl', () => {
  it('accepts jpeg/png/webp data URLs and rejects others', () => {
    expect(checkImageDataUrl('data:image/jpeg;base64,aaaa')).toEqual({ ok: true });
    expect(checkImageDataUrl('data:image/jpg;base64,aaaa')).toEqual({ ok: true });
    expect(checkImageDataUrl('data:image/png;base64,aaaa')).toEqual({ ok: true });
    expect(checkImageDataUrl('data:image/webp;base64,aaaa')).toEqual({ ok: true });
    expect(checkImageDataUrl('data:image/gif;base64,aaaa')).toEqual({
      error: 'send a PNG, JPEG or WebP data URL',
      status: 400,
    });
  });

  it('rejects an oversized payload', () => {
    const tooBig = `data:image/jpeg;base64,${'a'.repeat(Math.floor(MAX_IMAGE_BYTES / 0.75) + 10)}`;
    expect(checkImageDataUrl(tooBig)).toEqual({ error: 'image too large', status: 413 });
  });
});

describe('entitlementActive / extractJsonObject', () => {
  it('lifetime (null expiry) and future expiry are active; missing or past are not', () => {
    const t = Date.parse('2026-06-01T00:00:00Z');
    expect(entitlementActive({ expires_date: null }, t)).toBe(true);
    expect(entitlementActive({ expires_date: '2026-07-01T00:00:00Z' }, t)).toBe(true);
    expect(entitlementActive({ expires_date: '2026-05-01T00:00:00Z' }, t)).toBe(false);
    expect(entitlementActive(undefined, t)).toBe(false);
  });

  it('pulls the first JSON object out of model prose', () => {
    expect(extractJsonObject('Sure.\n{"storeName":"Aldi"}\n')).toBe('{"storeName":"Aldi"}');
    expect(extractJsonObject('no json here')).toBeNull();
  });
});
