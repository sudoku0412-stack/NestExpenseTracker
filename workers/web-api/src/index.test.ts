import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { cors, isPremium, resetJwksCache, verifyIdToken } from './index';

const PROJECT = 'nest-test';
const envBase = {
  AI: { run: vi.fn() },
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: 'https://app.example,https://other.example',
  REVENUECAT_API_KEY: 'rc_key',
};

function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function rsaPair() {
  return crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
}

async function jwkWithKid(key: CryptoKey, kid: string) {
  const jwk = await crypto.subtle.exportKey('jwk', key);
  return { ...jwk, kid };
}

async function signJwt(privateKey: CryptoKey, header: Record<string, unknown>, claims: Record<string, unknown>) {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

const validClaims = (sub = 'uid-1') => ({
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  exp: Math.floor(Date.now() / 1000) + 3600,
  sub,
});

let pair: Awaited<ReturnType<typeof rsaPair>>;
let publicJwk: JsonWebKey & { kid: string };

beforeEach(async () => {
  resetJwksCache();
  pair = await rsaPair();
  publicJwk = await jwkWithKid(pair.publicKey, 'kid-1');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('service_accounts')) {
        return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      }
      return new Response('not mocked', { status: 500 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('verifyIdToken', () => {
  it('rejects malformed, wrong-alg, expired, wrong-audience and empty-sub tokens without hitting crypto', async () => {
    expect(await verifyIdToken('not-a-jwt', PROJECT)).toBeNull();
    const h = b64url(JSON.stringify({ alg: 'HS256', kid: 'kid-1' }));
    const p = b64url(JSON.stringify(validClaims()));
    expect(await verifyIdToken(`${h}.${p}.sig`, PROJECT)).toBeNull();

    const { privateKey } = pair;
    const expired = await signJwt(privateKey, { alg: 'RS256', kid: 'kid-1' }, { ...validClaims(), exp: 1 });
    expect(await verifyIdToken(expired, PROJECT)).toBeNull();

    const wrongAud = await signJwt(privateKey, { alg: 'RS256', kid: 'kid-1' }, { ...validClaims(), aud: 'other' });
    expect(await verifyIdToken(wrongAud, PROJECT)).toBeNull();

    const noSub = await signJwt(privateKey, { alg: 'RS256', kid: 'kid-1' }, { ...validClaims(), sub: '' });
    expect(await verifyIdToken(noSub, PROJECT)).toBeNull();
  });

  it('returns the uid for a signature that matches Google JWKS', async () => {
    const token = await signJwt(pair.privateKey, { alg: 'RS256', kid: 'kid-1' }, validClaims('user-42'));
    expect(await verifyIdToken(token, PROJECT)).toBe('user-42');
  });

  it('rejects a valid-looking token signed with a different key', async () => {
    const other = await rsaPair();
    const token = await signJwt(other.privateKey, { alg: 'RS256', kid: 'kid-1' }, validClaims());
    expect(await verifyIdToken(token, PROJECT)).toBeNull();
  });
});

describe('isPremium', () => {
  it('returns null when RevenueCat is not configured or errors', async () => {
    expect(await isPremium('u', { ...envBase, REVENUECAT_API_KEY: undefined })).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 500 }));
    expect(await isPremium('u', envBase)).toBeNull();
  });

  it('treats 404 and a missing entitlement as not premium', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response('', { status: 404 }));
    expect(await isPremium('u', envBase)).toBe(false);
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ subscriber: { entitlements: {} } }), { status: 200 }));
    expect(await isPremium('u', envBase)).toBe(false);
  });

  it('is premium when the entitlement never expires or expires in the future', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: null } } } }), { status: 200 }),
    );
    expect(await isPremium('u', envBase)).toBe(true);
    const future = new Date(Date.now() + 86400000).toISOString();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: future } } } }), { status: 200 }),
    );
    expect(await isPremium('u', envBase)).toBe(true);
    const past = new Date(Date.now() - 86400000).toISOString();
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: past } } } }), { status: 200 }),
    );
    expect(await isPremium('u', envBase)).toBe(false);
  });
});

describe('cors', () => {
  it('echoes an allowed origin and falls back to the first allow-list entry', () => {
    const allowed = cors(new Request('https://api.example/v1', { headers: { Origin: 'https://app.example' } }), envBase);
    expect(allowed['Access-Control-Allow-Origin']).toBe('https://app.example');
    const other = cors(new Request('https://api.example/v1', { headers: { Origin: 'https://evil.example' } }), envBase);
    expect(other['Access-Control-Allow-Origin']).toBe('https://app.example');
  });
});

describe('fetch handler', () => {
  async function authed(path: string, init: RequestInit = {}) {
    const token = await signJwt(pair.privateKey, { alg: 'RS256', kid: 'kid-1' }, validClaims());
    return new Request(`https://api.example${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
    });
  }

  it('answers OPTIONS without auth and 401s missing tokens', async () => {
    const opt = await worker.fetch(new Request('https://api.example/v1/premium', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } }), envBase);
    expect(opt.status).toBe(204);
    const unauth = await worker.fetch(new Request('https://api.example/v1/premium'), envBase);
    expect(unauth.status).toBe(401);
    expect(await unauth.json()).toEqual({ error: 'unauthorized' });
  });

  it('GET /v1/premium returns 503 when RevenueCat is down and 200 when it is not', async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      if (String(url).includes('service_accounts')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      return new Response('', { status: 500 });
    });
    expect((await worker.fetch(await authed('/v1/premium'), envBase)).status).toBe(503);

    vi.mocked(fetch).mockImplementation(async (url: string) => {
      if (String(url).includes('service_accounts')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      return new Response(JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: null } } } }), { status: 200 });
    });
    const ok = await worker.fetch(await authed('/v1/premium'), envBase);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ premium: true });
  });

  it('POST /v1/parse-receipt requires Premium, a small PNG/JPEG/WebP data URL, and parseable JSON', async () => {
    vi.mocked(fetch).mockImplementation(async (url: string) => {
      if (String(url).includes('service_accounts')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      return new Response(JSON.stringify({ subscriber: { entitlements: {} } }), { status: 200 });
    });
    expect((await worker.fetch(await authed('/v1/parse-receipt', { method: 'POST', body: '{}' }), envBase)).status).toBe(402);

    vi.mocked(fetch).mockImplementation(async (url: string) => {
      if (String(url).includes('service_accounts')) return new Response(JSON.stringify({ keys: [publicJwk] }), { status: 200 });
      return new Response(JSON.stringify({ subscriber: { entitlements: { premium: { expires_date: null } } } }), { status: 200 });
    });
    expect((await worker.fetch(await authed('/v1/parse-receipt', { method: 'POST', body: 'not-json' }), envBase)).status).toBe(400);
    expect(
      (await worker.fetch(await authed('/v1/parse-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'data:text/plain,x' }) }), envBase)).status,
    ).toBe(400);

    const huge = `data:image/png;base64,${'A'.repeat(9_000_000)}`;
    expect(
      (await worker.fetch(await authed('/v1/parse-receipt', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: huge }) }), envBase)).status,
    ).toBe(413);

    envBase.AI.run.mockResolvedValueOnce({ response: 'sorry, no json here' });
    expect(
      (
        await worker.fetch(
          await authed('/v1/parse-receipt', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ image: 'data:image/jpeg;base64,abc' }),
          }),
          envBase,
        )
      ).status,
    ).toBe(422);

    envBase.AI.run.mockResolvedValueOnce({ response: 'Here you go {"storeName":"Aldi","totalAmount":4} trailing' });
    const parsed = await worker.fetch(
      await authed('/v1/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/webp;base64,abc' }),
      }),
      envBase,
    );
    expect(parsed.status).toBe(200);
    expect(await parsed.json()).toEqual({ receipt: { storeName: 'Aldi', totalAmount: 4 } });
  });

  it('404s unknown paths', async () => {
    expect((await worker.fetch(await authed('/v1/nope'), envBase)).status).toBe(404);
  });
});
