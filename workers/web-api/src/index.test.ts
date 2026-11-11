import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, {
  bearerToken,
  entitlementIsActive,
  inspectParseImage,
  resetJwksCache,
  sliceJsonObject,
} from './index';

const PROJECT = 'balancesheet-android';
const KID = 'test-kid';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const b64url = (bytes: ArrayBuffer | Uint8Array | string) => {
  const u8 = typeof bytes === 'string'
    ? new TextEncoder().encode(bytes)
    : bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;

beforeEach(async () => {
  resetJwksCache();
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function signJwt(claims: Record<string, unknown>, header: Record<string, unknown> = { alg: 'RS256', kid: KID }): Promise<string> {
  const h = b64url(JSON.stringify(header));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

function stubNetwork(opts: { revenuecat?: Response; ai?: { response?: string } } = {}) {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('service_accounts/v1/jwk')) {
      return jsonResponse({ keys: [{ ...publicJwk, kid: KID }] });
    }
    if (url.includes('api.revenuecat.com')) {
      return opts.revenuecat ?? jsonResponse({ subscriber: { entitlements: { premium: { expires_date: null } } } });
    }
    throw new Error(`unexpected fetch ${url}`);
  }));
}

function env(overrides: Partial<{ AI: { run: ReturnType<typeof vi.fn> }; REVENUECAT_API_KEY?: string }> = {}) {
  return {
    AI: { run: overrides.AI?.run ?? vi.fn() },
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGINS: 'https://nestexpensetracker.craftloop.ca,http://localhost:5173',
    REVENUECAT_API_KEY: 'REVENUECAT_API_KEY' in overrides ? overrides.REVENUECAT_API_KEY : 'sk_test',
  };
}

const validClaims = () => ({
  aud: PROJECT,
  iss: `https://securetoken.google.com/${PROJECT}`,
  sub: 'user-1',
  exp: Math.floor(Date.now() / 1000) + 3600,
});

describe('token and image helpers', () => {
  it('strips a Bearer prefix case-insensitively', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken('bearer abc')).toBe('abc');
    expect(bearerToken(null)).toBe('');
  });

  it('accepts jpeg/png/webp data URLs and rejects other types or oversized payloads', () => {
    expect(inspectParseImage('data:image/jpeg;base64,abc')).toBe('ok');
    expect(inspectParseImage('data:image/jpg;base64,abc')).toBe('ok');
    expect(inspectParseImage('data:image/gif;base64,abc')).toBe('bad-type');
    expect(inspectParseImage('data:image/png;base64,' + 'a'.repeat(40), 10)).toBe('too-large');
  });

  it('pulls the first JSON object out of model prose', () => {
    expect(sliceJsonObject('Sure.\n{"storeName":"X"}\n')).toBe('{"storeName":"X"}');
    expect(sliceJsonObject('no json here')).toBeNull();
  });

  it('treats a missing or expired entitlement as not premium, and null expiry as lifetime', () => {
    const now = Date.parse('2026-03-15T00:00:00Z');
    expect(entitlementIsActive(undefined, now)).toBe(false);
    expect(entitlementIsActive({ expires_date: null }, now)).toBe(true);
    expect(entitlementIsActive({ expires_date: '2026-03-16T00:00:00Z' }, now)).toBe(true);
    expect(entitlementIsActive({ expires_date: '2026-03-14T00:00:00Z' }, now)).toBe(false);
  });
});

describe('nest-web-api fetch', () => {
  it('answers CORS preflight without requiring a token', async () => {
    const res = await worker.fetch(
      new Request('https://api.example/v1/premium', {
        method: 'OPTIONS',
        headers: { Origin: 'https://nestexpensetracker.craftloop.ca' },
      }),
      env() as never,
    );
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://nestexpensetracker.craftloop.ca');
  });

  it('falls back to the first allowed origin when the request Origin is unknown', async () => {
    const res = await worker.fetch(
      new Request('https://api.example/v1/premium', { method: 'OPTIONS', headers: { Origin: 'https://evil.example' } }),
      env() as never,
    );
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://nestexpensetracker.craftloop.ca');
  });

  it('rejects a missing or malformed token', async () => {
    stubNetwork();
    const noAuth = await worker.fetch(new Request('https://api.example/v1/premium'), env() as never);
    expect(noAuth.status).toBe(401);
    const bad = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } }),
      env() as never,
    );
    expect(bad.status).toBe(401);
  });

  it('rejects a token with the wrong audience, algorithm, or expiry', async () => {
    stubNetwork();
    const wrongAud = await signJwt({ ...validClaims(), aud: 'other-project' });
    const hs = b64url(JSON.stringify({ alg: 'HS256', kid: KID })) + '.' + b64url(JSON.stringify(validClaims())) + '.sig';
    const expired = await signJwt({ ...validClaims(), exp: Math.floor(Date.now() / 1000) - 10 });
    for (const token of [wrongAud, hs, expired]) {
      const res = await worker.fetch(
        new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${token}` } }),
        env() as never,
      );
      expect(res.status).toBe(401);
    }
  });

  it('returns 503 when RevenueCat is not configured', async () => {
    stubNetwork();
    const token = await signJwt(validClaims());
    const res = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${token}` } }),
      env({ REVENUECAT_API_KEY: undefined }) as never,
    );
    expect(res.status).toBe(503);
  });

  it('returns premium false for a RevenueCat 404 and true for a lifetime entitlement', async () => {
    stubNetwork({ revenuecat: jsonResponse({}, 404) });
    const token = await signJwt(validClaims());
    const missing = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${token}` } }),
      env() as never,
    );
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ premium: false });

    resetJwksCache();
    stubNetwork();
    const lifetime = await worker.fetch(
      new Request('https://api.example/v1/premium', { headers: { Authorization: `Bearer ${token}` } }),
      env() as never,
    );
    expect(await lifetime.json()).toEqual({ premium: true });
  });

  it('blocks receipt parsing for non-premium users and bad images', async () => {
    stubNetwork({ revenuecat: jsonResponse({ subscriber: { entitlements: {} } }) });
    const token = await signJwt(validClaims());
    const denied = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,abc' }),
      }),
      env() as never,
    );
    expect(denied.status).toBe(402);

    resetJwksCache();
    stubNetwork();
    const badImage = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/gif;base64,abc' }),
      }),
      env() as never,
    );
    expect(badImage.status).toBe(400);
  });

  it('returns the parsed receipt JSON when the model wraps it in prose', async () => {
    const run = vi.fn(async () => ({ response: 'Here you go\n{"storeName":"Aldi","totalAmount":12.5}\n' }));
    stubNetwork();
    const token = await signJwt(validClaims());
    const res = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/webp;base64,abc' }),
      }),
      env({ AI: { run } }) as never,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: { storeName: 'Aldi', totalAmount: 12.5 } });
    expect(run).toHaveBeenCalledOnce();
  });

  it('returns 422 when the model output is not JSON', async () => {
    const run = vi.fn(async () => ({ response: 'I cannot read that' }));
    stubNetwork();
    const token = await signJwt(validClaims());
    const res = await worker.fetch(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/png;base64,abc' }),
      }),
      env({ AI: { run } }) as never,
    );
    expect(res.status).toBe(422);
  });

  it('returns 404 for unknown routes', async () => {
    stubNetwork();
    const token = await signJwt(validClaims());
    const res = await worker.fetch(
      new Request('https://api.example/v1/nope', { headers: { Authorization: `Bearer ${token}` } }),
      env() as never,
    );
    expect(res.status).toBe(404);
  });
});
