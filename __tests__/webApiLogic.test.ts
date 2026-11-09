import {
  corsHeaders,
  entitlementIsActive,
  extractJsonObject,
  handleAuthed,
  isPremium,
  json,
  MAX_IMAGE_BYTES,
  validateParseImage,
  type Env,
} from '../workers/web-api/src/logic';

const originalFetch = global.fetch;

const env = (over: Partial<Env> = {}): Env => ({
  AI: { run: jest.fn() },
  FIREBASE_PROJECT_ID: 'proj',
  ALLOWED_ORIGINS: 'https://nestexpensetracker.craftloop.ca,https://example.com',
  REVENUECAT_API_KEY: 'rc_key',
  ...over,
});

const headers = { 'Access-Control-Allow-Origin': 'https://nestexpensetracker.craftloop.ca' };

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('entitlementIsActive', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  it('is false with no entitlement', () => {
    expect(entitlementIsActive(undefined, now)).toBe(false);
  });
  it('treats a null expiry as lifetime Premium', () => {
    expect(entitlementIsActive({ expires_date: null }, now)).toBe(true);
  });
  it('is true before expiry and false after', () => {
    expect(entitlementIsActive({ expires_date: '2026-11-10T00:00:00Z' }, now)).toBe(true);
    expect(entitlementIsActive({ expires_date: '2026-11-08T00:00:00Z' }, now)).toBe(false);
  });
});

describe('isPremium', () => {
  it('returns null when RevenueCat is not configured', async () => {
    await expect(isPremium('u1', env({ REVENUECAT_API_KEY: undefined }))).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });
  it('returns false on a 404 subscriber', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 404, json: async () => ({}) });
    await expect(isPremium('u1', env())).resolves.toBe(false);
  });
  it('returns null when RevenueCat is down', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    await expect(isPremium('u1', env())).resolves.toBeNull();
  });
  it('reads the premium entitlement and URL-encodes the uid', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ subscriber: { entitlements: { premium: { expires_date: null } } } }),
    });
    await expect(isPremium('u/1', env())).resolves.toBe(true);
    expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe(
      'https://api.revenuecat.com/v1/subscribers/u%2F1',
    );
  });
});

describe('corsHeaders', () => {
  it('echoes an allowed Origin and falls back to the first allow-list entry', () => {
    const allowed = corsHeaders(
      new Request('https://api.example/v1/premium', { headers: { Origin: 'https://example.com' } }),
      'https://nestexpensetracker.craftloop.ca,https://example.com',
    );
    expect(allowed['Access-Control-Allow-Origin']).toBe('https://example.com');
    const blocked = corsHeaders(
      new Request('https://api.example/v1/premium', { headers: { Origin: 'https://evil.test' } }),
      'https://nestexpensetracker.craftloop.ca,https://example.com',
    );
    expect(blocked['Access-Control-Allow-Origin']).toBe('https://nestexpensetracker.craftloop.ca');
  });
});

describe('validateParseImage / extractJsonObject', () => {
  it('accepts jpeg/png/webp data URLs and rejects others', () => {
    expect(validateParseImage('data:image/jpeg;base64,abc').ok).toBe(true);
    expect(validateParseImage('data:image/jpg;base64,abc').ok).toBe(true);
    expect(validateParseImage('data:image/png;base64,abc').ok).toBe(true);
    expect(validateParseImage('data:image/webp;base64,abc').ok).toBe(true);
    expect(validateParseImage('data:image/gif;base64,abc')).toMatchObject({ ok: false, status: 400 });
    expect(validateParseImage('https://evil.test/x.jpg')).toMatchObject({ ok: false, status: 400 });
  });
  it('rejects an oversized data URL', () => {
    const huge = `data:image/jpeg;base64,${'A'.repeat(Math.ceil(MAX_IMAGE_BYTES / 0.75) + 10)}`;
    expect(validateParseImage(huge)).toMatchObject({ ok: false, status: 413 });
  });
  it('pulls JSON out of surrounding model prose and returns null when it is missing or invalid', () => {
    expect(extractJsonObject('Sure.\n{"storeName":"Aldi","totalAmount":12}\nThanks')).toEqual({
      storeName: 'Aldi',
      totalAmount: 12,
    });
    expect(extractJsonObject('no json here')).toBeNull();
    expect(extractJsonObject('{not json}')).toBeNull();
  });
});

describe('handleAuthed', () => {
  const rc = (body: unknown, status = 200) => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    });
  };

  it('GET /v1/premium returns the entitlement', async () => {
    rc({ subscriber: { entitlements: { premium: { expires_date: null } } } });
    const res = await handleAuthed(new Request('https://api.test/v1/premium'), env(), 'uid', headers);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ premium: true });
  });

  it('GET /v1/premium is 503 when RevenueCat is unconfigured', async () => {
    const res = await handleAuthed(
      new Request('https://api.test/v1/premium'),
      env({ REVENUECAT_API_KEY: undefined }),
      'uid',
      headers,
    );
    expect(res.status).toBe(503);
  });

  it('POST /v1/parse-receipt requires Premium and a valid image', async () => {
    rc({ subscriber: { entitlements: {} } });
    const denied = await handleAuthed(
      new Request('https://api.test/v1/parse-receipt', {
        method: 'POST',
        body: JSON.stringify({ image: 'data:image/jpeg;base64,abc' }),
      }),
      env(),
      'uid',
      headers,
    );
    expect(denied.status).toBe(402);

    rc({ subscriber: { entitlements: { premium: { expires_date: null } } } });
    const bad = await handleAuthed(
      new Request('https://api.test/v1/parse-receipt', { method: 'POST', body: 'not-json' }),
      env(),
      'uid',
      headers,
    );
    expect(bad.status).toBe(400);
  });

  it('returns the parsed receipt when Workers AI replies with JSON in prose', async () => {
    rc({ subscriber: { entitlements: { premium: { expires_date: null } } } });
    const run = jest.fn(async () => ({ response: 'Here you go {"storeName":"Costco","totalAmount":9.5} done' }));
    const res = await handleAuthed(
      new Request('https://api.test/v1/parse-receipt', {
        method: 'POST',
        body: JSON.stringify({ image: 'data:image/png;base64,abc' }),
      }),
      env({ AI: { run } }),
      'uid',
      headers,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ receipt: { storeName: 'Costco', totalAmount: 9.5 } });
    expect(run).toHaveBeenCalled();
  });

  it('returns 422 when the model does not yield JSON, and 404 for unknown routes', async () => {
    rc({ subscriber: { entitlements: { premium: { expires_date: null } } } });
    const empty = await handleAuthed(
      new Request('https://api.test/v1/parse-receipt', {
        method: 'POST',
        body: JSON.stringify({ image: 'data:image/webp;base64,abc' }),
      }),
      env({ AI: { run: async () => ({ response: 'sorry' }) } }),
      'uid',
      headers,
    );
    expect(empty.status).toBe(422);
    const missing = await handleAuthed(new Request('https://api.test/v1/nope'), env(), 'uid', headers);
    expect(missing.status).toBe(404);
  });

  it('json() sets the content type', async () => {
    const res = json({ ok: true }, 201, headers);
    expect(res.status).toBe(201);
    expect(res.headers.get('Content-Type')).toBe('application/json');
  });
});
