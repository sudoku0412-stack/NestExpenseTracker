export interface Env {
  AI: { run: (model: string, input: unknown) => Promise<{ response?: string }> };
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS: string;
  REVENUECAT_API_KEY?: string;
}

export const PREMIUM_ENTITLEMENT_ID = 'premium';
export const VISION_MODEL = '@cf/meta/llama-3.2-11b-vision-instruct';
export const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
export const IMAGE_DATA_URL = /^data:image\/(png|jpe?g|webp);base64,/;

export const PARSE_PROMPT = `You read a photo of a store receipt. Reply with ONLY a JSON object, no prose:
{"storeName": string, "date": "YYYY-MM-DD" or null, "totalAmount": number, "subtotalAmount": number or null, "taxAmount": number or null,
 "category": one of Groceries|Electronics|Dining|Pharmacy|Gas|Clothing|Entertainment|Travel|Healthcare|Electricity|Other,
 "lineItems": [{"name": string, "amount": number}]}
Amounts are plain numbers in the receipt's own currency. Use a negative amount for discounts. If a value is unreadable use null.`;

export function corsHeaders(req: Request, allowedCsv: string): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = allowedCsv.split(',').map((s) => s.trim());
  return {
    'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : allowed[0],
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export const json = (data: unknown, status: number, headers: Record<string, string>) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** Lifetime (null expiry) or a date still in the future counts as Premium. */
export function entitlementIsActive(
  ent: { expires_date: string | null } | undefined,
  nowMs = Date.now(),
): boolean {
  if (!ent) return false;
  return ent.expires_date === null || new Date(ent.expires_date).getTime() > nowMs;
}

export async function isPremium(uid: string, env: Env, nowMs = Date.now()): Promise<boolean | null> {
  if (!env.REVENUECAT_API_KEY) return null;
  const res = await fetch(`https://api.revenuecat.com/v1/subscribers/${encodeURIComponent(uid)}`, {
    headers: { Authorization: `Bearer ${env.REVENUECAT_API_KEY}`, 'Content-Type': 'application/json' },
  });
  if (res.status === 404) return false;
  if (!res.ok) return null;
  const body = (await res.json()) as { subscriber?: { entitlements?: Record<string, { expires_date: string | null }> } };
  return entitlementIsActive(body.subscriber?.entitlements?.[PREMIUM_ENTITLEMENT_ID], nowMs);
}

export function validateParseImage(image: string): { ok: true } | { ok: false; status: number; error: string } {
  if (!IMAGE_DATA_URL.test(image)) return { ok: false, status: 400, error: 'send a PNG, JPEG or WebP data URL' };
  if (image.length * 0.75 > MAX_IMAGE_BYTES) return { ok: false, status: 413, error: 'image too large' };
  return { ok: true };
}

/** Pulls the first JSON object out of model prose. Returns null when none. */
export function extractJsonObject(text: string): unknown | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/** Routing after the Firebase ID token has already been verified. */
export async function handleAuthed(req: Request, env: Env, uid: string, headers: Record<string, string>): Promise<Response> {
  const url = new URL(req.url);

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
    const imageCheck = validateParseImage(image);
    if (!imageCheck.ok) return json({ error: imageCheck.error }, imageCheck.status, headers);
    try {
      const out = await env.AI.run(VISION_MODEL, {
        messages: [{ role: 'user', content: [{ type: 'text', text: PARSE_PROMPT }, { type: 'image_url', image_url: { url: image } }] }],
        max_tokens: 1500,
      });
      const parsed = extractJsonObject(out.response ?? '');
      if (parsed === null) return json({ error: 'could not read the receipt' }, 422, headers);
      return json({ receipt: parsed }, 200, headers);
    } catch {
      return json({ error: 'could not read the receipt' }, 422, headers);
    }
  }

  return json({ error: 'not found' }, 404, headers);
}
