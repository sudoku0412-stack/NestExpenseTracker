import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const PROJECT = 'test-project';
const ORIGINS = 'https://app.example,http://localhost:5173';

let privateKey: CryptoKey;
let publicJwk: JsonWebKey & { kid: string };

const b64url = (data: ArrayBuffer | Uint8Array | string): string => {
  const buf = typeof data === 'string' ? Buffer.from(data) : Buffer.from(data instanceof ArrayBuffer ? data : data.buffer);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signToken(claims: Record<string, unknown>, header: Record<string, unknown> = {}): Promise<string> {
  const h = b64url(JSON.stringify({ alg: 'RS256', kid: publicJwk.kid, ...header }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(sig)}`;
}

async function validToken(sub = 'uid-1', extra: Record<string, unknown> = {}): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return signToken({
    aud: PROJECT,
    iss: `https://securetoken.google.com/${PROJECT}`,
    exp: now + 3600,
    sub,
    ...extra,
  });
}

beforeAll(async () => {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  privateKey = pair.privateKey;
  publicJwk = { ...(await crypto.subtle.exportKey('jwk', pair.publicKey)), kid: 'test-kid' };
});

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Env = {
  AI: { run: ReturnType<typeof vi.fn> };
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  REVENUECAT_API_KEY?: string;
};

async function loadApp() {
  return (await import('../../../../workers/web-api/src/index')).default;
}

function stubNetwork(opts: {
  jwksOk?: boolean;
  rcStatus?: number;
  rcBody?: unknown;
} = {}) {
  const { jwksOk = true, rcStatus = 200, rcBody = { subscriber: { entitlements: {} } } } = opts;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('googleapis.com')) {
        if (!jwksOk) return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, json: async () => ({ keys: [publicJwk] }) };
      }
      if (url.includes('api.revenuecat.com')) {
        return {
          ok: rcStatus >= 200 && rcStatus < 300,
          status: rcStatus,
          json: async () => rcBody,
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    }),
  );
}

function env(over: Partial<Env> = {}): Env {
  return {
    AI: { run: vi.fn() },
    FIREBASE_PROJECT_ID: PROJECT,
    ALLOWED_ORIGINS: ORIGINS,
    REVENUECAT_API_KEY: 'sk_test',
    ...over,
  };
}

async function call(
  app: { fetch: (req: Request, env: Env) => Promise<Response> },
  path: string,
  init: RequestInit & { env?: Env } = {},
) {
  const { env: e = env(), ...rest } = init;
  return app.fetch(new Request(`https://worker.test${path}`, rest), e);
}

describe('cors and auth', () => {
  it('answers OPTIONS without requiring a token', async () => {
    const app = await loadApp();
    const res = await call(app, '/v1/premium', {
      method: 'OPTIONS',
      headers: { Origin: 'https://app.example' },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
  });

  it('falls back to the first allowed origin when Origin is unknown', async () => {
    stubNetwork();
    const app = await loadApp();
    const res = await call(app, '/v1/premium', { headers: { Origin: 'https://evil.example' } });
    expect(res.status).toBe(401);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://app.example');
  });

  it('rejects missing, malformed, wrong-alg, wrong-audience, expired, and bad-signature tokens', async () => {
    stubNetwork();
    const app = await loadApp();
    const now = Math.floor(Date.now() / 1000);
    const goodClaims = {
      aud: PROJECT,
      iss: `https://securetoken.google.com/${PROJECT}`,
      exp: now + 3600,
      sub: 'uid-1',
    };

    const missing = await call(app, '/v1/premium');
    expect(missing.status).toBe(401);

    const malformed = await call(app, '/v1/premium', { headers: { Authorization: 'Bearer not-a-jwt' } });
    expect(malformed.status).toBe(401);

    const hs256 = await call(app, '/v1/premium', {
      headers: { Authorization: `Bearer ${await signToken(goodClaims, { alg: 'HS256' })}` },
    });
    expect(hs256.status).toBe(401);

    const wrongAud = await call(app, '/v1/premium', {
      headers: { Authorization: `Bearer ${await signToken({ ...goodClaims, aud: 'other' })}` },
    });
    expect(wrongAud.status).toBe(401);

    const expired = await call(app, '/v1/premium', {
      headers: { Authorization: `Bearer ${await signToken({ ...goodClaims, exp: now - 10 })}` },
    });
    expect(expired.status).toBe(401);

    const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', kid: publicJwk.kid }))}.${b64url(JSON.stringify(goodClaims))}.${b64url('nope')}`;
    const badSig = await call(app, '/v1/premium', { headers: { Authorization: `Bearer ${unsigned}` } });
    expect(badSig.status).toBe(401);
  });
});

describe('GET /v1/premium', () => {
  it('returns 503 when RevenueCat is not configured or errors', async () => {
    stubNetwork();
    const app = await loadApp();
    const tok = await validToken();
    const unconfigured = await call(app, '/v1/premium', {
      headers: { Authorization: `Bearer ${tok}` },
      env: env({ REVENUECAT_API_KEY: undefined }),
    });
    expect(unconfigured.status).toBe(503);

    stubNetwork({ rcStatus: 500 });
    const app2 = await loadApp();
    const down = await call(app2, '/v1/premium', { headers: { Authorization: `Bearer ${tok}` } });
    expect(down.status).toBe(503);
  });

  it('is not premium when the subscriber is missing or has no premium entitlement', async () => {
    stubNetwork({ rcStatus: 404 });
    const app = await loadApp();
    const tok = await validToken();
    const missing = await call(app, '/v1/premium', { headers: { Authorization: `Bearer ${tok}` } });
    expect(missing.status).toBe(200);
    expect(await missing.json()).toEqual({ premium: false });

    stubNetwork({ rcBody: { subscriber: { entitlements: { extra: { expires_date: null } } } } });
    const app2 = await loadApp();
    const none = await call(app2, '/v1/premium', { headers: { Authorization: `Bearer ${tok}` } });
    expect(await none.json()).toEqual({ premium: false });
  });

  it('treats a null expiry as lifetime premium and a past expiry as lapsed', async () => {
    stubNetwork({ rcBody: { subscriber: { entitlements: { premium: { expires_date: null } } } } });
    const app = await loadApp();
    const tok = await validToken();
    const lifetime = await call(app, '/v1/premium', { headers: { Authorization: `Bearer ${tok}` } });
    expect(await lifetime.json()).toEqual({ premium: true });

    stubNetwork({
      rcBody: { subscriber: { entitlements: { premium: { expires_date: '2020-01-01T00:00:00Z' } } } },
    });
    const app2 = await loadApp();
    const lapsed = await call(app2, '/v1/premium', { headers: { Authorization: `Bearer ${tok}` } });
    expect(await lapsed.json()).toEqual({ premium: false });

    stubNetwork({
      rcBody: { subscriber: { entitlements: { premium: { expires_date: '2099-01-01T00:00:00Z' } } } },
    });
    const app3 = await loadApp();
    const active = await call(app3, '/v1/premium', { headers: { Authorization: `Bearer ${tok}` } });
    expect(await active.json()).toEqual({ premium: true });
  });
});

describe('POST /v1/parse-receipt', () => {
  const jpeg = 'data:image/jpeg;base64,aaaa';

  it('requires premium and a PNG/JPEG/WebP data URL under 6MB', async () => {
    stubNetwork({ rcBody: { subscriber: { entitlements: {} } } });
    const app = await loadApp();
    const tok = await validToken();
    const paywalled = await call(app, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
    });
    expect(paywalled.status).toBe(402);

    stubNetwork({ rcBody: { subscriber: { entitlements: { premium: { expires_date: null } } } } });
    const app2 = await loadApp();
    const badJson = await call(app2, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    expect(badJson.status).toBe(400);

    const badType = await call(app2, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: 'data:image/gif;base64,xx' }),
    });
    expect(badType.status).toBe(400);

    const tooBig = await call(app2, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: `data:image/png;base64,${'A'.repeat(9 * 1024 * 1024)}` }),
    });
    expect(tooBig.status).toBe(413);
  });

  it('extracts the JSON object from model prose and 422s when there is none', async () => {
    stubNetwork({ rcBody: { subscriber: { entitlements: { premium: { expires_date: null } } } } });
    const tok = await validToken();
    const e = env();
    e.AI.run.mockResolvedValue({
      response: 'Sure.\n{"storeName":"Costco","totalAmount":12.5}\nThanks',
    });
    const app = await loadApp();
    const ok = await call(app, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
      env: e,
    });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ receipt: { storeName: 'Costco', totalAmount: 12.5 } });

    e.AI.run.mockResolvedValue({ response: 'no json here' });
    const empty = await call(app, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
      env: e,
    });
    expect(empty.status).toBe(422);

    e.AI.run.mockRejectedValue(new Error('model down'));
    const boom = await call(app, '/v1/parse-receipt', {
      method: 'POST',
      headers: { Authorization: `Bearer ${tok}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: jpeg }),
      env: e,
    });
    expect(boom.status).toBe(422);
  });

  it('returns 404 for unknown routes once the caller is signed in', async () => {
    stubNetwork();
    const app = await loadApp();
    const res = await call(app, '/v1/nope', { headers: { Authorization: `Bearer ${await validToken()}` } });
    expect(res.status).toBe(404);
  });
});
