import { generateKeyPairSync, sign } from 'node:crypto';
import {
  corsHeaders,
  entitlementIsActive,
  extractJsonObject,
  MAX_IMAGE_BYTES,
  parseImageError,
} from '../workers/web-api/src/logic';
import worker, { resetJwksCache } from '../workers/web-api/src/index';

const PROJECT = 'balancesheet-android';
const ALLOWED = 'https://nestexpensetracker.craftloop.ca,https://nestexpensetracker-web.pages.dev,http://localhost:5173';
const KID = 'test-kid';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = publicKey.export({ format: 'jwk' }) as JsonWebKey;

function b64urlJson(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj)).toString('base64url');
}

function makeJwt(claims: Record<string, unknown>, alg = 'RS256'): string {
  const h = b64urlJson({ alg, kid: KID });
  const p = b64urlJson(claims);
  const sig = sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey);
  return `${h}.${p}.${sig.toString('base64url')}`;
}

function validClaims(over: Record<string, unknown> = {}) {
  return {
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: 'uid-1',
    ...over,
  };
}

const validImage = 'data:image/jpeg;base64,aaaa';

type Rc = { status?: number; body?: unknown };
let rc: Rc = {};
let aiResponse: string | undefined = '{"storeName":"X","totalAmount":1}';
const aiRun = jest.fn(async (_model?: unknown, _input?: unknown) => ({ response: aiResponse }));

const env = {
  AI: { run: (model: string, input: unknown) => aiRun(model, input) },
  FIREBASE_PROJECT_ID: PROJECT,
  ALLOWED_ORIGINS: ALLOWED,
  REVENUECAT_API_KEY: 'sk_test',
};

function call(path: string, init: RequestInit = {}) {
  return worker.fetch(new Request(`https://api.example${path}`, init), env);
}

beforeEach(() => {
  resetJwksCache();
  rc = { status: 200, body: { subscriber: { entitlements: { premium: { expires_date: null } } } } };
  aiResponse = '{"storeName":"X","totalAmount":1}';
  aiRun.mockClear();
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('service_accounts/v1/jwk')) {
      return new Response(JSON.stringify({ keys: [{ ...jwk, kid: KID, kty: 'RSA', alg: 'RS256', use: 'sig' }] }), { status: 200 });
    }
    if (url.includes('api.revenuecat.com')) {
      return new Response(JSON.stringify(rc.body ?? {}), { status: rc.status ?? 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('cors and auth gates', () => {
  it('answers OPTIONS without requiring a token and echoes an allowed origin', async () => {
    const res = await call('/v1/premium', { method: 'OPTIONS', headers: { Origin: 'http://localhost:5173' } });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
  });

  it('falls back to the first allowed origin for an unknown site', () => {
    const h = corsHeaders('https://evil.example', ALLOWED);
    expect(h['Access-Control-Allow-Origin']).toBe('https://nestexpensetracker.craftloop.ca');
  });

  it('rejects missing, malformed, expired, and wrong-audience tokens', async () => {
    expect((await call('/v1/premium')).status).toBe(401);
    expect((await call('/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } })).status).toBe(401);
    const expired = makeJwt(validClaims({ exp: Math.floor(Date.now() / 1000) - 10 }));
    expect((await call('/v1/premium', { headers: { Authorization: `Bearer ${expired}` } })).status).toBe(401);
    const wrongAud = makeJwt(validClaims({ aud: 'other-project' }));
    expect((await call('/v1/premium', { headers: { Authorization: `Bearer ${wrongAud}` } })).status).toBe(401);
  });
});

describe('GET /v1/premium', () => {
  it('returns premium true for a lifetime entitlement', async () => {
    const res = await call('/v1/premium', { headers: { Authorization: `Bearer ${makeJwt(validClaims())}` } });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ premium: true });
  });

  it('returns premium false when RevenueCat has no premium entitlement or a 404', async () => {
    rc = { status: 200, body: { subscriber: { entitlements: {} } } };
    const noEnt = await call('/v1/premium', { headers: { Authorization: `Bearer ${makeJwt(validClaims())}` } });
    expect(await noEnt.json()).toEqual({ premium: false });
    rc = { status: 404, body: {} };
    const missing = await call('/v1/premium', { headers: { Authorization: `Bearer ${makeJwt(validClaims())}` } });
    expect(await missing.json()).toEqual({ premium: false });
  });

  it('returns 503 when RevenueCat is down', async () => {
    rc = { status: 500, body: { error: 'nope' } };
    const res = await call('/v1/premium', { headers: { Authorization: `Bearer ${makeJwt(validClaims())}` } });
    expect(res.status).toBe(503);
  });
});

describe('POST /v1/parse-receipt', () => {
  const auth = () => ({ Authorization: `Bearer ${makeJwt(validClaims())}`, 'Content-Type': 'application/json' });

  it('requires an active premium entitlement', async () => {
    rc = { status: 200, body: { subscriber: { entitlements: {} } } };
    const res = await call('/v1/parse-receipt', { method: 'POST', headers: auth(), body: JSON.stringify({ image: validImage }) });
    expect(res.status).toBe(402);
    expect(aiRun).not.toHaveBeenCalled();
  });

  it('rejects non-images, oversized payloads, and unreadable model output', async () => {
    expect(parseImageError('data:text/plain;base64,xx')?.status).toBe(400);
    expect(parseImageError(`data:image/png;base64,${'A'.repeat(Math.ceil((MAX_IMAGE_BYTES + 1) / 0.75))}`)?.status).toBe(413);

    const badType = await call('/v1/parse-receipt', {
      method: 'POST', headers: auth(), body: JSON.stringify({ image: 'data:text/plain;base64,xx' }),
    });
    expect(badType.status).toBe(400);

    aiResponse = 'sorry I cannot see a receipt';
    const unread = await call('/v1/parse-receipt', {
      method: 'POST', headers: auth(), body: JSON.stringify({ image: validImage }),
    });
    expect(unread.status).toBe(422);
  });

  it('returns the JSON object even when the model wraps it in prose', async () => {
    aiResponse = 'Here you go:\n{"storeName":"Costco","totalAmount":12.5}\nThanks';
    const res = await call('/v1/parse-receipt', {
      method: 'POST', headers: auth(), body: JSON.stringify({ image: validImage }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ receipt: { storeName: 'Costco', totalAmount: 12.5 } });
  });
});

describe('entitlementIsActive / extractJsonObject', () => {
  it('treats null expiry as lifetime and a past date as lapsed', () => {
    const now = Date.parse('2026-03-01T00:00:00Z');
    expect(entitlementIsActive(null, now)).toBe(true);
    expect(entitlementIsActive('2026-04-01T00:00:00Z', now)).toBe(true);
    expect(entitlementIsActive('2026-02-01T00:00:00Z', now)).toBe(false);
    expect(entitlementIsActive(undefined, now)).toBe(false);
  });

  it('returns null when the model reply has no JSON object', () => {
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{oops')).toBeNull();
  });
});
