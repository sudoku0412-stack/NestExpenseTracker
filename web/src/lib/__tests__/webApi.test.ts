import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import worker from '../../../../workers/web-api/src/index.ts';

const PROJECT = 'balancesheet-test';
const UID = 'user-1';
const KID = 'test-kid';
const ORIGIN = 'https://app.example';

const envBase = {
  AI: { run: vi.fn() },
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: `${ORIGIN}, https://other.example`,
  REVENUECAT_API_KEY: 'rc-key',
};

let publicJwk: JsonWebKey & { kid: string };
let privateKey: CryptoKey;

const b64url = (bytes: Uint8Array | string): string => {
  const raw = typeof bytes === 'string' ? bytes : String.fromCharCode(...bytes);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signToken(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: KID }): Promise<string> {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  const sig = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`)));
  return `${h}.${p}.${b64url(sig)}`;
}

async function validToken(extra: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    exp: now + 3600,
    sub: UID,
    ...extra,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

let rcBody: unknown = { subscriber: { entitlements: {} } };
let rcStatus = 200;

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  publicJwk = { ...jwk, kid: KID };
});

afterEach(() => {
  vi.unstubAllGlobals();
  envBase.AI.run.mockReset();
  rcBody = { subscriber: { entitlements: {} } };
  rcStatus = 200;
});

function stubNetwork() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('googleapis.com')) return jsonResponse({ keys: [publicJwk] });
      if (url.includes('api.revenuecat.com')) return jsonResponse(rcBody, rcStatus);
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

async function call(
  path: string,
  init: RequestInit = {},
  env: typeof envBase = envBase,
): Promise<Response> {
  stubNetwork();
  return worker.fetch(new Request(`https://api.example${path}`, init), env);
}

describe('nest-web-api auth and cors', () => {
  it('answers OPTIONS without requiring a token', async () => {
    const res = await call('/v1/premium', { method: 'OPTIONS', headers: { Origin: ORIGIN } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('echoes an allowed Origin and falls back when the Origin is unknown', async () => {
    const ok = await call('/v1/premium', { headers: { Origin: ORIGIN } });
    expect(ok.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const other = await call('/v1/premium', { headers: { Origin: 'https://evil.example' } });
    expect(other.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  });

  it('rejects a missing or malformed bearer token', async () => {
    expect((await call('/v1/premium')).status).toBe(401);
    expect((await call('/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } })).status).toBe(401);
  });

  it('rejects a token for the wrong Firebase project', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({
      aud: 'other-project',
      iss: 'https://securetoken.google.com/other-project',
      exp: now + 3600,
      sub: UID,
    });
    const res = await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await signToken({
      aud: PROJECT,
      iss: `https://securetoken.google.com/${PROJECT}`,
      exp: now - 10,
      sub: UID,
    });
    const res = await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});

describe('/v1/premium', () => {
  it('returns 503 when RevenueCat is not configured', async () => {
    const token = await validToken();
    const { REVENUECAT_API_KEY: _omit, ...noKey } = envBase;
    const res = await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } }, noKey);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'premium check unavailable' });
  });

  it('is not premium when the subscriber is missing or has no entitlement', async () => {
    const token = await validToken();
    rcStatus = 404;
    expect(await (await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({
      premium: false,
    });
    rcStatus = 200;
    rcBody = { subscriber: { entitlements: {} } };
    expect(await (await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({
      premium: false,
    });
  });

  it('treats a lifetime grant (null expiry) as premium and an expired grant as not', async () => {
    const token = await validToken();
    rcBody = { subscriber: { entitlements: { premium: { expires_date: null } } } };
    expect(await (await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({
      premium: true,
    });
    rcBody = { subscriber: { entitlements: { premium: { expires_date: '2000-01-01T00:00:00Z' } } } };
    expect(await (await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({
      premium: false,
    });
    rcBody = { subscriber: { entitlements: { premium: { expires_date: '2099-01-01T00:00:00Z' } } } };
    expect(await (await call('/v1/premium', { headers: { Authorization: `Bearer ${token}` } })).json()).toEqual({
      premium: true,
    });
  });
});

describe('/v1/parse-receipt', () => {
  const jpeg = 'data:image/jpeg;base64,abc';

  it('requires premium', async () => {
    const token = await validToken();
    rcBody = { subscriber: { entitlements: {} } };
    const res = await call('/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
    });
    expect(res.status).toBe(402);
    expect(envBase.AI.run).not.toHaveBeenCalled();
  });

  it('rejects invalid JSON, the wrong image type, and oversized payloads', async () => {
    const token = await validToken();
    rcBody = { subscriber: { entitlements: { premium: { expires_date: null } } } };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await call('/v1/parse-receipt', { method: 'POST', headers, body: 'not-json' })).status).toBe(400);
    expect(
      (await call('/v1/parse-receipt', { method: 'POST', headers, body: JSON.stringify({ image: 'data:image/gif;base64,xx' }) })).status,
    ).toBe(400);
    const huge = `data:image/png;base64,${'A'.repeat(8_500_000)}`;
    expect((await call('/v1/parse-receipt', { method: 'POST', headers, body: JSON.stringify({ image: huge }) })).status).toBe(413);
    expect(envBase.AI.run).not.toHaveBeenCalled();
  });

  it('extracts JSON from model prose and 422s when there is none', async () => {
    const token = await validToken();
    rcBody = { subscriber: { entitlements: { premium: { expires_date: null } } } };
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    envBase.AI.run.mockResolvedValueOnce({
      response: 'Sure.\n{"storeName":"Aldi","totalAmount":12}\nThanks',
    });
    const ok = await call('/v1/parse-receipt', { method: 'POST', headers, body: JSON.stringify({ image: jpeg }) });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ receipt: { storeName: 'Aldi', totalAmount: 12 } });

    envBase.AI.run.mockResolvedValueOnce({ response: 'I could not read that.' });
    const miss = await call('/v1/parse-receipt', { method: 'POST', headers, body: JSON.stringify({ image: jpeg }) });
    expect(miss.status).toBe(422);
  });

  it('404s unknown routes after auth', async () => {
    const token = await validToken();
    const res = await call('/v1/nope', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(404);
  });
});
