import {
  corsHeaders,
  extractJsonObject,
  imageExceedsLimit,
  isReceiptImageDataUrl,
  parseBearer,
  premiumFromRevenueCatBody,
  routeAuthed,
  type WorkerEnv,
} from '../workers/web-api/src/logic';

const headers = { 'Access-Control-Allow-Origin': 'https://app.example' };
const now = Date.parse('2026-11-08T12:00:00Z');

function env(over: Partial<WorkerEnv> & { rcStatus?: number; rcBody?: unknown } = {}): WorkerEnv {
  const rcStatus = over.rcStatus ?? 200;
  const rcBody = over.rcBody ?? { subscriber: { entitlements: { premium: { expires_date: null } } } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('revenuecat.com')) {
      return new Response(JSON.stringify(rcBody), { status: rcStatus });
    }
    return originalFetch(input);
  }) as typeof fetch;
  return {
    AI: over.AI ?? { run: async () => ({ response: '{"storeName":"Aldi","totalAmount":12}' }) },
    REVENUECAT_API_KEY: over.REVENUECAT_API_KEY === undefined ? 'rc_key' : over.REVENUECAT_API_KEY,
  };
}

describe('parseBearer / cors / image / JSON extract', () => {
  it('strips Bearer case-insensitively and leaves the rest of the token', () => {
    expect(parseBearer('Bearer abc.def')).toBe('abc.def');
    expect(parseBearer('bearer abc')).toBe('abc');
    expect(parseBearer(null)).toBe('');
    expect(parseBearer('Basic x')).toBe('Basic x');
  });

  it('echoes an allowlisted Origin and otherwise falls back to the first allowed origin', () => {
    const allowed = 'https://nestexpensetracker.craftloop.ca, http://localhost:5173';
    expect(corsHeaders('http://localhost:5173', allowed)['Access-Control-Allow-Origin']).toBe('http://localhost:5173');
    expect(corsHeaders('https://evil.example', allowed)['Access-Control-Allow-Origin']).toBe(
      'https://nestexpensetracker.craftloop.ca',
    );
  });

  it('accepts PNG/JPEG/WebP data URLs only', () => {
    expect(isReceiptImageDataUrl('data:image/png;base64,aaa')).toBe(true);
    expect(isReceiptImageDataUrl('data:image/jpeg;base64,aaa')).toBe(true);
    expect(isReceiptImageDataUrl('data:image/jpg;base64,aaa')).toBe(true);
    expect(isReceiptImageDataUrl('data:image/webp;base64,aaa')).toBe(true);
    expect(isReceiptImageDataUrl('data:image/gif;base64,aaa')).toBe(false);
    expect(isReceiptImageDataUrl('https://cdn.example/x.png')).toBe(false);
  });

  it('rejects images whose data-URL is larger than the decoded-byte budget', () => {
    expect(imageExceedsLimit('data:image/png;base64,' + 'a'.repeat(100), 1000)).toBe(false);
    expect(imageExceedsLimit('data:image/png;base64,' + 'a'.repeat(2000), 1000)).toBe(true);
  });

  it('pulls the first-to-last JSON object out of model prose', () => {
    expect(extractJsonObject('Sure:\n{"a":1}\nThanks')).toBe('{"a":1}');
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('}{')).toBeNull();
  });
});

describe('premiumFromRevenueCatBody', () => {
  it('is true for a lifetime entitlement and a not-yet-expired date', () => {
    expect(premiumFromRevenueCatBody({ subscriber: { entitlements: { premium: { expires_date: null } } } }, now)).toBe(true);
    expect(
      premiumFromRevenueCatBody(
        { subscriber: { entitlements: { premium: { expires_date: '2026-12-01T00:00:00Z' } } } },
        now,
      ),
    ).toBe(true);
  });

  it('is false when the entitlement is missing or already expired', () => {
    expect(premiumFromRevenueCatBody({ subscriber: { entitlements: {} } }, now)).toBe(false);
    expect(
      premiumFromRevenueCatBody(
        { subscriber: { entitlements: { premium: { expires_date: '2026-01-01T00:00:00Z' } } } },
        now,
      ),
    ).toBe(false);
  });
});

describe('routeAuthed', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('GET /v1/premium returns 503 when RevenueCat is not configured', async () => {
    const res = await routeAuthed(
      new Request('https://api.example/v1/premium'),
      env({ REVENUECAT_API_KEY: '' }),
      'uid1',
      headers,
      now,
    );
    expect(res.status).toBe(503);
  });

  it('GET /v1/premium returns the entitlement boolean', async () => {
    const res = await routeAuthed(
      new Request('https://api.example/v1/premium'),
      env(),
      'uid1',
      headers,
      now,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ premium: true });
  });

  it('POST /v1/parse-receipt is 402 without Premium and 400 without a data URL', async () => {
    const noPrem = env({ rcBody: { subscriber: { entitlements: {} } } });
    const blocked = await routeAuthed(
      new Request('https://api.example/v1/parse-receipt', { method: 'POST', body: '{}' }),
      noPrem,
      'uid1',
      headers,
      now,
    );
    expect(blocked.status).toBe(402);

    const bad = await routeAuthed(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'not-an-image' }),
      }),
      env(),
      'uid1',
      headers,
      now,
    );
    expect(bad.status).toBe(400);
  });

  it('POST /v1/parse-receipt returns the JSON object hidden in model prose', async () => {
    const res = await routeAuthed(
      new Request('https://api.example/v1/parse-receipt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: 'data:image/jpeg;base64,aaa' }),
      }),
      env({
        AI: { run: async () => ({ response: 'Here you go\n{"storeName":"Costco","totalAmount":41.2}\n' }) },
      }),
      'uid1',
      headers,
      now,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: { storeName: 'Costco', totalAmount: 41.2 } });
  });

  it('returns 404 for unknown paths', async () => {
    const res = await routeAuthed(new Request('https://api.example/v1/nope'), env(), 'uid1', headers, now);
    expect(res.status).toBe(404);
  });
});
