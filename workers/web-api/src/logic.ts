/** Pure helpers for nest-web-api. Kept free of Cloudflare bindings so tests can run in Node. */

export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/;

export const PARSE_PROMPT = `You read a photo of a store receipt. Reply with ONLY a JSON object, no prose:
{"storeName": string, "date": "YYYY-MM-DD" or null, "totalAmount": number, "subtotalAmount": number or null, "taxAmount": number or null,
 "category": one of Groceries|Electronics|Dining|Pharmacy|Gas|Clothing|Entertainment|Travel|Healthcare|Electricity|Other,
 "lineItems": [{"name": string, "amount": number}]}
Amounts are plain numbers in the receipt's own currency. Use a negative amount for discounts. If a value is unreadable use null.`;

export function parseBearer(authorization: string | null): string {
  return (authorization ?? '').replace(/^Bearer\s+/i, '');
}

export function corsHeaders(origin: string, allowedOriginsCsv: string): Record<string, string> {
  const allowed = allowedOriginsCsv.split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function entitlementIsActive(
  ent: { expires_date: string | null } | undefined,
  now: number,
): boolean {
  if (!ent) return false;
  return ent.expires_date === null || new Date(ent.expires_date).getTime() > now;
}

export function premiumFromRevenueCatBody(body: unknown, now: number): boolean {
  const ent = (body as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } })
    ?.subscriber?.entitlements?.[PREMIUM_ENTITLEMENT_ID];
  return entitlementIsActive(ent, now);
}

export function isReceiptImageDataUrl(image: string): boolean {
  return IMAGE_DATA_URL.test(image);
}

/** Approximate decoded size from a data-URL's character length (same 0.75 factor as the worker). */
export function imageExceedsLimit(image: string, maxBytes = MAX_IMAGE_BYTES): boolean {
  return image.length * 0.75 > maxBytes;
}

export function extractJsonObject(text: string): string | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  return text.slice(start, end + 1);
}

export type WorkerEnv = {
  AI: { run: (model: string, input: unknown) => Promise<{ response?: string }> };
  REVENUECAT_API_KEY?: string;
};

export async function isPremium(
  uid: string,
  env: Pick<WorkerEnv, 'REVENUECAT_API_KEY'>,
  now = Date.now(),
): Promise<boolean | null> {
  if (!env.REVENUECAT_API_KEY) return null;
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${env.REVENUECAT_API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return false;
  if (!res.ok) return null;
  const body = await res.json();
  return premiumFromRevenueCatBody(body, now);
}

const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Routes an already-authenticated request. Token verification stays in index.ts. */
export async function routeAuthed(
  req: Request,
  env: WorkerEnv,
  uid: string,
  headers: Record<string, string>,
  now = Date.now(),
): Promise<Response> {
  const url = new URL(req.url);

  if (url.pathname === '/v1/premium' && req.method === 'GET') {
    const premium = await isPremium(uid, env, now);
    if (premium === null) return json({ error: 'premium check unavailable' }, 503, headers);
    return json({ premium }, 200, headers);
  }

  if (url.pathname === '/v1/parse-receipt' && req.method === 'POST') {
    const premium = await isPremium(uid, env, now);
    if (premium === null) return json({ error: 'premium check unavailable' }, 503, headers);
    if (!premium) return json({ error: 'premium required' }, 402, headers);
    let body: { image?: string };
    try {
      body = (await req.json()) as { image?: string };
    } catch {
      return json({ error: 'invalid body' }, 400, headers);
    }
    const image = body.image ?? '';
    if (!isReceiptImageDataUrl(image)) return json({ error: 'send a PNG, JPEG or WebP data URL' }, 400, headers);
    if (imageExceedsLimit(image)) return json({ error: 'image too large' }, 413, headers);
    try {
      const out = await env.AI.run(VISION_MODEL, {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: PARSE_PROMPT },
              { type: 'image_url', image_url: { url: image } },
            ],
          },
        ],
        max_tokens: 1500,
      });
      const raw = extractJsonObject(out.response ?? '');
      if (!raw) return json({ error: 'could not read the receipt' }, 422, headers);
      return json({ receipt: JSON.parse(raw) }, 200, headers);
    } catch {
      return json({ error: 'could not read the receipt' }, 422, headers);
    }
  }

  return json({ error: 'not found' }, 404, headers);
}
