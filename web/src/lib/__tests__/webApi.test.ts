import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, {
  checkReceiptImage,
  corsHeaders,
  extractJsonObject,
  jwtClaimsValid,
  MAX_IMAGE_BYTES,
  premiumFromEntitlement,
  resetJwksCache,
} from '../../../../workers/web-api/src/index';

const PROJECT = 'balancesheet-android';
const ORIGINS = 'https://nest.example,https://app.example';

function b64url(obj: unknown): string {
  return btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function jwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'k1' }): string {
  return `${b64url(header)}.${b64url(claims)}.${b64url('sig')}`;
}

function validClaims(overrides: Record<string, unknown> = {}) {
  return {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'uid-1',
    ...overrides,
  };
}

describe('jwtClaimsValid', () => {
  const now = 1_700_000_000;
  it('accepts a matching aud/iss with a future exp and non-empty sub', () => {
    expect(jwtClaimsValid(validClaims({ exp: now + 10 }), PROJECT, now)).toBe(true);
  });
  it('rejects a wrong audience, issuer, expired token, or empty sub', () => {
    expect(jwtClaimsValid(validClaims({ aud: 'other' }), PROJECT, now)).toBe(false);
    expect(jwtClaimsValid(validClaims({ iss: 'https://securetoken.google.com/other' }), PROJECT, now)).toBe(false);
    expect(jwtClaimsValid(validClaims({ exp: now - 1 }), PROJECT, now)).toBe(false);
    expect(jwtClaimsValid(validClaims({ sub: '' }), PROJECT, now)).toBe(false);
    expect(jwtClaimsValid(validClaims({ sub: 123 }), PROJECT, now)).toBe(false);
  });
});

describe('premiumFromEntitlement', () => {
  const now = Date.parse('2026-06-01T00:00:00Z');
  it('is false with no entitlement', () => {
    expect(premiumFromEntitlement(undefined, now)).toBe(false);
  });
  it('treats a null expires_date as lifetime Premium', () => {
    expect(premiumFromEntitlement({ expires_date: null }, now)).toBe(true);
  });
  it('is true only while expires_date is in the future', () => {
    expect(premiumFromEntitlement({ expires_date: '2026-07-01T00:00:00Z' }, now)).toBe(true);
    expect(premiumFromEntitlement({ expires_date: '2026-05-01T00:00:00Z' }, now)).toBe(false);
  });
});

describe('checkReceiptImage', () => {
  it('accepts png, jpeg, jpg and webp data URLs', () => {
    expect(checkReceiptImage('data:image/png;base64,aaa')).toBe('ok');
    expect(checkReceiptImage('data:image/jpeg;base64,aaa')).toBe('ok');
    expect(checkReceiptImage('data:image/jpg;base64,aaa')).toBe('ok');
    expect(checkReceiptImage('data:image/webp;base64,aaa')).toBe('ok');
  });
  it('rejects other schemes and oversize payloads', () => {
    expect(checkReceiptImage('data:image/gif;base64,aaa')).toBe('type');
    expect(checkReceiptImage('https://example/x.png')).toBe('type');
    expect(checkReceiptImage(`data:image/png;base64,${'a'.repeat(20)}`, 10)).toBe('size');
  });
  it('uses the production size cap by default', () => {
    expect(MAX_IMAGE_BYTES).toBe(6 * 1024 * 1024);
  });
});

describe('extractJsonObject', () => {
  it('slices the first { through the last } so prose around the JSON is ignored', () => {
    expect(extractJsonObject('Sure.\n{"storeName":"Aldi","totalAmount":12}\nThanks')).toEqual({
      storeName: 'Aldi',
      totalAmount: 12,
    });
  });
  it('returns null when there is no object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('}{')).toBeNull();
  });
});

describe('corsHeaders', () => {
  it('echoes an allowed Origin and falls back to the first allow-list entry', () => {
    expect(corsHeaders('https://app.example', ORIGINS)['Access-Control-Allow-Origin']).toBe('https://app.example');
    expect(corsHeaders('https://evil.example', ORIGINS)['Access-Control-Allow-Origin']).toBe('https://nest.example');
  });
});

describe('worker fetch', () => {
  const env = {
    AI: { run: vi.fn(async () => ({ response: '{"storeName":"Costco","totalAmount":10}' })) },
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGINS: ORIGINS,
    REVENUECAT_API_KEY: 'rc-secret',
  };

  beforeEach(() => {
    resetJwksCache();
    vi.spyOn(crypto.subtle, 'importKey').mockResolvedValue({} as CryptoKey);
    vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(true);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('googleapis.com')) {
          return new Response(JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', n: 'n', e: 'AQAB' }] }), { status: 200 });
        }
        if (url.includes('revenuecat.com')) {
          return new Response(
            JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: null } } } }),
            { status: 200 },
          );
        }
        return new Response('no', { status: 404 });
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const authed = (path: string, init: RequestInit = {}) =>
    new Request(`https://api.example${path}`, {
      ...init,
      headers: {
        Origin: 'https://app.example',
        Authorization: `Bearer ${jwt(validClaims())}`,
        ...(init.headers ?? {}),
      },
    });

  it('answers OPTIONS without requiring a token', async () => {
    const res = await worker.fetch(new Request('https://api.example/v1/premium', { method: 'OPTIONS' }), env);
    expect(res.status).toBe(204);
  });

  it('rejects a missing or malformed bearer token', async () => {
    const noAuth = await worker.fetch(new Request('https://api.example/v1/premium'), env);
    expect(noAuth.status).toBe(401);
    const bad = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } }),
      env,
    );
    expect(bad.status).toBe(401);
  });

  it('rejects HS256 and expired tokens even when the signature verify stub would pass', async () => {
    const hs = await worker.fetch(
      new Request('https://api.example/v1/premium', {
        headers: { Authorization: `Bearer ${jwt(validClaims(), { alg: 'HS256', kid: 'k1' })}` },
      }),
      env,
    );
    expect(hs.status).toBe(401);
    const expired = await worker.fetch(
      new Request('https://api.example/v1/premium', {
        headers: { Authorization: `Bearer ${jwt(validClaims({ exp: 1 }))}` },
      }),
      env,
    );
    expect(expired.status).toBe(401);
  });

  it('returns 401 when the signature does not verify', async () => {
    vi.spyOn(crypto.subtle, 'verify').mockResolvedValue(false);
    const res = await worker.fetch(authed('/v1/premium'), env);
    expect(res.status).toBe(401);
  });

  it('returns premium true from RevenueCat', async () => {
    const res = await worker.fetch(authed('/v1/premium'), env);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ premium: true });
  });

  it('returns 503 when RevenueCat is not configured', async () => {
    const res = await worker.fetch(authed('/v1/premium'), { ...env, REVENUECAT_API_KEY: undefined });
    expect(res.status).toBe(503);
  });

  it('blocks parse-receipt for a non-premium subscriber', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('googleapis.com')) {
          return new Response(JSON.stringify({ keys: [{ kid: 'k1', kty: 'RSA', n: 'n', e: 'AQAB' }] }), { status: 200 });
        }
        return new Response(JSON.stringify({ subscriber: { entitlements: {} } }), { status: 200 });
      }),
    );
    const res = await worker.fetch(
      authed('/v1/parse-receipt', {
        method: 'POST',
        body: JSON.stringify({ image: 'data:image/png;base64,aa' }),
        headers: { 'Content-Type': 'application/json' },
      }),
      env,
    );
    expect(res.status).toBe(402);
  });

  it('rejects a non-image payload before calling the vision model', async () => {
    const res = await worker.fetch(
      authed('/v1/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/gif;base64,aa' }),
      }),
      env,
    );
    expect(res.status).toBe(400);
    expect(env.AI.run).not.toHaveBeenCalled();
  });

  it('returns 422 when the model replies without JSON', async () => {
    env.AI.run.mockResolvedValueOnce({ response: 'I cannot read this' });
    const res = await worker.fetch(
      authed('/v1/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/jpeg;base64,aaaa' }),
      }),
      env,
    );
    expect(res.status).toBe(422);
  });

  it('parses a receipt image for a premium user', async () => {
    const res = await worker.fetch(
      authed('/v1/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/jpeg;base64,aaaa' }),
      }),
      env,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: { storeName: 'Costco', totalAmount: 10 } });
  });

  it('returns 404 for unknown paths after auth', async () => {
    const res = await worker.fetch(authed('/v1/nope'), env);
    expect(res.status).toBe(404);
  });
});
