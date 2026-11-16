import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, {
  cors,
  entitlementIsActive,
  extractJsonObject,
  MAX_IMAGE_BYTES,
  receiptImageError,
  resetJwksCache,
} from '../../../../workers/web-api/src/index';

const PROJECT = 'balancesheet-android';
const ORIGINS = 'https://nestexpensetracker.craftloop.ca,http://localhost:5173';

const b64url = (buf: ArrayBuffer | Uint8Array): string => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function makeSigner() {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const jwk = (await crypto.subtle.exportKey('jwk', pair.publicKey)) as JsonWebKey & { kid: string };
  jwk.kid = 'test-kid';
  const sign = async (claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: 'test-kid' }) => {
    const h = b64url(new TextEncoder().encode(JSON.stringify(header)));
    const p = b64url(new TextEncoder().encode(JSON.stringify(claims)));
    const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(`${h}.${p}`));
    return `${h}.${p}.${b64url(sig)}`;
  };
  return { jwk, sign };
}

const validClaims = (sub = 'uid-1', extra: Record<string, unknown> = {}) => ({
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub,
  ...extra,
});

describe('cors', () => {
  it('echoes an allowed Origin and falls back to the first allow-list entry', () => {
    const env = { ALLOWED_ORIGINS: ORIGINS } as { ALLOWED_ORIGINS: string };
    const allowed = cors(new Request('https://api.example', { headers: { Origin: 'http://localhost:5173' } }), env as never);
    expect(allowed['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    const unknown = cors(new Request('https://api.example', { headers: { Origin: 'https://evil.example' } }), env as never);
    expect(unknown['Access-Control-Allow-Origin']).toBe('https://nestexpensetracker.craftloop.ca');
  });
});

describe('entitlementIsActive', () => {
  const now = Date.parse('2026-11-16T13:00:00Z');
  it('is false when the premium entitlement is missing', () => {
    expect(entitlementIsActive(undefined, now)).toBe(false);
  });
  it('treats a null expiry as a lifetime grant', () => {
    expect(entitlementIsActive({ expires_date: null }, now)).toBe(true);
  });
  it('is true only while expires_date is still in the future', () => {
    expect(entitlementIsActive({ expires_date: '2026-11-16T12:59:59Z' }, now)).toBe(false);
    expect(entitlementIsActive({ expires_date: '2026-11-16T13:00:01Z' }, now)).toBe(true);
  });
});

describe('receiptImageError', () => {
  it('accepts PNG, JPEG and WebP data URLs', () => {
    expect(receiptImageError('data:image/png;base64,aaaa')).toBeNull();
    expect(receiptImageError('data:image/jpeg;base64,aaaa')).toBeNull();
    expect(receiptImageError('data:image/jpg;base64,aaaa')).toBeNull();
    expect(receiptImageError('data:image/webp;base64,aaaa')).toBeNull();
  });
  it('rejects other types and oversize payloads', () => {
    expect(receiptImageError('data:image/gif;base64,aaaa')).toEqual({
      status: 400,
      error: 'send a PNG, JPEG or WebP data URL',
    });
    expect(receiptImageError('https://example/receipt.png')).toMatchObject({ status: 400 });
    const huge = `data:image/png;base64,${'a'.repeat(Math.ceil(MAX_IMAGE_BYTES / 0.75))}`;
    expect(receiptImageError(huge)).toEqual({ status: 413, error: 'image too large' });
  });
});

describe('extractJsonObject', () => {
  it('pulls the first JSON object out of model prose', () => {
    expect(extractJsonObject('Sure.\n{"storeName":"Aldi","totalAmount":12.5}\nThanks')).toEqual({
      storeName: 'Aldi',
      totalAmount: 12.5,
    });
  });
  it('returns null when there is no object or the slice is not JSON', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('prefix {not json} trailing')).toBeNull();
  });
});

describe('worker fetch', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    resetJwksCache();
    vi.restoreAllMocks();
  });

  async function envWithAuth(premiumBody: unknown, status = 200) {
    const { jwk, sign } = await makeSigner();
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('googleapis.com')) {
        return new Response(JSON.stringify({ keys: [jwk] }), { status: 200 });
      }
      if (url.includes('revenuecat.com')) {
        return new Response(JSON.stringify(premiumBody), { status });
      }
      return new Response('unexpected', { status: 500 });
    }) as typeof fetch;
    const token = await sign(validClaims());
    const env = {
      AI: { run: vi.fn() },
      FIREBASE_PROJECT_ID: PROJECT,
      ALLOWED_ORIGINS: ORIGINS,
      REVENUECAT_API_KEY: 'rc_test',
    };
    return { env, token };
  }

  it('answers OPTIONS without auth', async () => {
    const res = await worker.fetch(
      new Request('https://api.example/v1/premium', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } }),
      { AI: { run: async () => ({}) }, FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGINS },
    );
    expect(res.status).toBe(204);
  });

  it('rejects missing or malformed tokens', async () => {
    const env = { AI: { run: async () => ({}) }, FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGINS };
    const noAuth = await worker.fetch(new Request('https://api.example/v1/premium'), env);
    expect(noAuth.status).toBe(401);
    const junk = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } }),
      env,
    );
    expect(junk.status).toBe(401);
  });

  it('rejects expired tokens, wrong audience, and the wrong algorithm', async () => {
    const { jwk, sign } = await makeSigner();
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ keys: [jwk] }), { status: 200 })) as typeof fetch;
    const env = { AI: { run: async () => ({}) }, FIREBASE_PROJECT_ID: PROJECT, ALLOWED_ORIGINS: ORIGINS, REVENUECAT_API_KEY: 'k' };
    const expired = await sign(validClaims('uid-1', { exp: Math.floor(Date.now() / 1000) - 10 }));
    expect((await worker.fetch(new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${expired}` } }), env)).status).toBe(401);
    resetJwksCache();
    const wrongAud = await sign(validClaims('uid-1', { aud: 'other-project' }));
    expect((await worker.fetch(new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${wrongAud}` } }), env)).status).toBe(401);
    resetJwksCache();
    const hs = await sign(validClaims(), { alg: 'HS256', kid: 'test-kid' });
    expect((await worker.fetch(new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${hs}` } }), env)).status).toBe(401);
  });

  it('GET /v1/premium returns the RevenueCat entitlement', async () => {
    const { env, token } = await envWithAuth({
      subscriber: { entitlements: { premium: { expires_date: null } } },
    });
    const res = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${token}` } }),
      env as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ premium: true });
  });

  it('GET /v1/premium is 503 when RevenueCat is down and 200 false for a missing subscriber', async () => {
    const down = await envWithAuth({}, 500);
    expect(
      (await worker.fetch(new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${down.token}` } }), down.env as never)).status,
    ).toBe(503);
    resetJwksCache();
    const missing = await envWithAuth({}, 404);
    const res = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${missing.token}` } }),
      missing.env as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ premium: false });
  });

  it('POST /v1/parse-receipt requires Premium and a valid image, then extracts the model JSON', async () => {
    const free = await envWithAuth({ subscriber: { entitlements: {} } });
    const blocked = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${free.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,aaaa' }),
      }),
      free.env as never,
    );
    expect(blocked.status).toBe(402);

    resetJwksCache();
    const { env, token } = await envWithAuth({ subscriber: { entitlements: { premium: { expires_date: null } } } });
    env.AI.run.mockResolvedValue({ response: 'Here you go {"storeName":"Costco","totalAmount":9.99} done' });
    const ok = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,aaaa' }),
      }),
      env as never,
    );
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ receipt: { storeName: 'Costco', totalAmount: 9.99 } });

    const badImage = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'not-an-image' }),
      }),
      env as never,
    );
    expect(badImage.status).toBe(400);

    env.AI.run.mockResolvedValue({ response: 'could not see a receipt' });
    const unreadable = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,aaaa' }),
      }),
      env as never,
    );
    expect(unreadable.status).toBe(422);
  });

  it('returns 404 for an unknown path', async () => {
    const { env, token } = await envWithAuth({ subscriber: { entitlements: {} } });
    const res = await worker.fetch(
      new Request('https://api.example/v1/nope', { headers: { Authorization: `Bearer ${token}` } }),
      env as never,
    );
    expect(res.status).toBe(404);
  });
});
