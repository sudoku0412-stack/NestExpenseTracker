import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, {
  entitlementIsActive,
  extractJsonObject,
  IMAGE_DATA_URL,
  MAX_IMAGE_BYTES,
  resetJwksCache,
} from './index';

const PROJECT = 'test-project';
const ORIGINS = 'https://app.example,http://localhost:5173';

function b64url(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlJson(obj: unknown): string {
  return b64url(new TextEncoder().encode(JSON.stringify(obj)));
}

let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'kid-1' };
});

async function mint(claims: Record<string, unknown>, alg = 'RS256', kid = 'kid-1'): Promise<string> {
  const h = b64urlJson({ alg, kid });
  const p = b64urlJson(claims);
  const sig = new Uint8Array(
    await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`)),
  );
  return `${h}.${p}.${b64url(sig)}`;
}

function validClaims(over: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000);
  return {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    exp: now + 3600,
    sub: 'uid-1',
    ...over,
  };
}

type Rc = { status?: number; body?: unknown } | 'missing-key';
let rc: Rc = { status: 200, body: { subscriber: { entitlements: { premium: { expires_date: null } } } } };
const ai = { run: vi.fn() };

function env(over: Record<string, unknown> = {}) {
  return {
    AI: ai,
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGINS: ORIGINS,
    REVENUECAT_API_KEY: rc === 'missing-key' ? undefined : 'rc-secret',
    ...over,
  } as never;
}

async function call(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://api.example${path}`, init), env());
}

const jpeg = 'data:image/jpeg;base64,aaaa';

beforeEach(() => {
  resetJwksCache();
  ai.run.mockReset();
  rc = { status: 200, body: { subscriber: { entitlements: { premium: { expires_date: null } } } } };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('service_accounts')) return Response.json({ keys: [publicJwk] });
      if (url.includes('revenuecat.com')) {
        const status = typeof rc === 'object' ? (rc.status ?? 200) : 500;
        const body = typeof rc === 'object' ? rc.body : {};
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response('no', { status: 404 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('entitlementIsActive / extractJsonObject', () => {
  it('treats lifetime and unexpired grants as premium, and missing/expired as not', () => {
    expect(entitlementIsActive(undefined)).toBe(false);
    expect(entitlementIsActive({})).toBe(false);
    expect(entitlementIsActive({ premium: { expires_date: null } })).toBe(true);
    expect(entitlementIsActive({ premium: { expires_date: '2099-01-01T00:00:00Z' } })).toBe(true);
    expect(entitlementIsActive({ premium: { expires_date: '2020-01-01T00:00:00Z' } })).toBe(false);
    expect(entitlementIsActive({ something_else: { expires_date: null } })).toBe(false);
  });

  it('pulls the first JSON object out of model prose and rejects garbage', () => {
    expect(extractJsonObject('Sure.\n{"storeName":"A","totalAmount":1}\nThanks')).toEqual({ storeName: 'A', totalAmount: 1 });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{not json')).toBeNull();
  });

  it('accepts jpeg/png/webp data URLs only', () => {
    expect(IMAGE_DATA_URL.test('data:image/png;base64,xx')).toBe(true);
    expect(IMAGE_DATA_URL.test('data:image/jpg;base64,xx')).toBe(true);
    expect(IMAGE_DATA_URL.test('data:image/gif;base64,xx')).toBe(false);
    expect(IMAGE_DATA_URL.test('https://evil/x.jpg')).toBe(false);
  });
});

describe('nest-web-api fetch', () => {
  it('answers CORS preflight without requiring a token', async () => {
    const res = await call('/v1/premium', { method: 'OPTIONS', headers: { Origin: 'https://app.example' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
  });

  it('does not reflect an unknown Origin (uses the first allow-list entry)', async () => {
    const res = await call('/v1/premium', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
    expect(res.status).toBe(401);
  });

  it('rejects a missing, malformed, expired, or wrong-audience token', async () => {
    expect((await call('/v1/premium')).status).toBe(401);
    expect((await call('/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } })).status).toBe(401);
    const expired = await mint(validClaims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect((await call('/v1/premium', { headers: { Authorization: `Bearer ${expired}` } })).status).toBe(401);
    const wrongAud = await mint(validClaims({ aud: 'other-project' }));
    expect((await call('/v1/premium', { headers: { Authorization: `Bearer ${wrongAud}` } })).status).toBe(401);
  });

  it('returns premium from RevenueCat for a valid token', async () => {
    const token = await mint(validClaims());
    const yes = await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } });
    expect(yes.status).toBe(200);
    expect(await yes.json()).toEqual({ premium: true });

    rc = { status: 200, body: { subscriber: { entitlements: {} } } };
    resetJwksCache();
    const no = await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } });
    expect(await no.json()).toEqual({ premium: false });
  });

  it('returns 503 when Premium cannot be checked', async () => {
    const token = await mint(validClaims());
    rc = 'missing-key';
    expect((await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(503);
    rc = { status: 500, body: {} };
    expect((await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(503);
  });

  it('blocks receipt parse for non-premium users and bad images', async () => {
    const token = await mint(validClaims());
    rc = { status: 200, body: { subscriber: { entitlements: {} } } };
    const unpaid = await call('/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
    });
    expect(unpaid.status).toBe(402);

    rc = { status: 200, body: { subscriber: { entitlements: { premium: { expires_date: null } } } } };
    const badType = await call('/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/gif;base64,xx' }),
    });
    expect(badType.status).toBe(400);

    const tooBig = 'data:image/jpeg;base64,' + 'a'.repeat(Math.floor(MAX_IMAGE_BYTES / 0.75) + 10);
    const huge = await call('/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: tooBig }),
    });
    expect(huge.status).toBe(413);
  });

  it('returns parsed JSON from the model and 422 when the model rambles', async () => {
    const token = await mint(validClaims());
    ai.run.mockResolvedValue({ response: 'Here you go {"storeName":"Costco","totalAmount":12.5} done' });
    const ok = await call('/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ receipt: { storeName: 'Costco', totalAmount: 12.5 } });

    ai.run.mockResolvedValue({ response: 'I cannot see a receipt' });
    const miss = await call('/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
    });
    expect(miss.status).toBe(422);
  });

  it('404s unknown paths', async () => {
    const token = await mint(validClaims());
    expect((await call('/v1/nope', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(404);
  });
});
