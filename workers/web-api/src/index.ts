/**
 * nest-web-api: the small server the NestExpenseTracker website needs.
 *
 *   GET  /v1/premium        -> { premium: boolean }   RevenueCat entitlement for the signed-in user
 *   POST /v1/parse-receipt  -> parsed receipt JSON    Workers AI vision, Premium only
 *
 * Every request must carry a Firebase ID token (Authorization: Bearer ...). It is verified
 * here against Google's public keys, so the uid cannot be spoofed.
 */

import {
  bearerToken,
  checkImageDataUrl,
  claimsAreValid,
  corsHeaders,
  entitlementActive,
  extractJsonObject,
  PREMIUM_ENTITLEMENT_ID,
} from './guards';

interface Env {
  AI: { run: (model: string, input: unknown) => Promise<{ response?: string }> };
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  REVENUECAT_API_KEY?: string;
}

const JWKS_URL = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';
const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';

type Jwk = JsonWebKey & { kid: string };
let jwksCache: { keys: Jwk[]; at: number } | null = null;

const b64urlToBytes = (s: string): Uint8Array => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '='));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKeys(): Promise<Jwk[]> {
  if (jwksCache && Date.now() - jwksCache.at < 60 * 60 * 1000) return jwksCache.keys;
  const res = await fetch(JWKS_URL);
  if (!res.ok) throw new Error('jwks');
  const { keys } = (await res.json()) as { keys: Jwk[] };
  jwksCache = { keys, at: Date.now() };
  return keys;
}

/** Returns the Firebase uid for a valid ID token, otherwise null. */
async function verifyIdToken(token: string, projectId: string): Promise<string | null> {
  try {
    const [h, p, sig] = token.split('.');
    if (!h || !p || !sig) return null;
    const header = decodeJson(h);
    const claims = decodeJson(p);
    const now = Math.floor(Date.now() / 1000);
    if (!claimsAreValid(header, claims, projectId, now)) return null;
    const jwk = (await getKeys()).find((k) => k.kid === header.kid);
    if (!jwk) return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlToBytes(sig), new TextEncoder().encode(`${h}.${p}`));
    return ok ? (claims.sub as string) : null;
  } catch {
    return null;
  }
}

async function isPremium(uid: string, env: Env): Promise<boolean | null> {
  if (!env.REVENUECAT_API_KEY) return null; // not configured
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${env.REVENUECAT_API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return false;
  if (!res.ok) return null;
  const body = (await res.json()) as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } };
  return entitlementActive(body.subscriber?.entitlements?.[PREMIUM_ENTITLEMENT_ID]);
}

const PARSE_PROMPT = `You read a photo of a store receipt. Reply with ONLY a JSON object, no prose:
{"storeName": string, "date": "YYYY-MM-DD" or null, "totalAmount": number, "subtotalAmount": number or null, "taxAmount": number or null,
 "category": one of Groceries|Electronics|Dining|Pharmacy|Gas|Clothing|Entertainment|Travel|Healthcare|Electricity|Other,
 "lineItems": [{"name": string, "amount": number}]}
Amounts are plain numbers in the receipt's own currency. Use a negative amount for discounts. If a value is unreadable use null.`;

const cors = (req: Request, env: Env) => corsHeaders(req.headers.get('Origin') ?? '', env.ALLOWED_ORIGINS);

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(req, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });

    const url = new URL(req.url);
    const bearer = bearerToken(req.headers.get('Authorization'));
    const uid = bearer ? await verifyIdToken(bearer, env.FIREBASE_PROJECT_ID) : null;
    if (!uid) return json({ error: 'unauthorized' }, 401, headers);

    if (url.pathname === '/v1/premium' && req.method === 'GET') {
      const premium = await isPremium(uid, env);
      if (premium === null) return json({ error: 'premium check unavailable' }, 503, headers);
      return json({ premium }, 200, headers);
    }

    if (url.pathname === '/v1/parse-receipt' && req.method === 'POST') {
      const premium = await isPremium(uid, env);
      if (premium === null) return json({ error: 'premium check unavailable' }, 503, headers);
      if (!premium) return json({ error: 'premium required' }, 402, headers);
      let body: { image?: string };
      try {
        body = (await req.json()) as { image?: string };
      } catch {
        return json({ error: 'invalid body' }, 400, headers);
      }
      const image = body.image ?? '';
      const imageCheck = checkImageDataUrl(image);
      if (!('ok' in imageCheck)) return json({ error: imageCheck.error }, imageCheck.status, headers);
      try {
        const out = await env.AI.run(VISION_MODEL, { messages: [{ role: 'user', content: [{ type: 'text', text: PARSE_PROMPT }, { type: 'image_url', image_url: { url: image } }] }], max_tokens: 1500 });
        const text = out.response ?? '';
        const blob = extractJsonObject(text);
        if (!blob) return json({ error: 'could not read the receipt' }, 422, headers);
        return json({ receipt: JSON.parse(blob) }, 200, headers);
      } catch {
        return json({ error: 'could not read the receipt' }, 422, headers);
      }
    }

    return json({ error: 'not found' }, 404, headers);
  },
};
