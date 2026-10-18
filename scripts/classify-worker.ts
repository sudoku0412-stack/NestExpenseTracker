/**
 * Cloudflare Worker that proxies item-name classification requests from the
 * NestExpenseTracker mobile app to the Anthropic API. Keeps the API key
 * server-side so it never ships in the APK.
 *
 * Deploy:
 *   1. Sign up at https://dash.cloudflare.com (free)
 *   2. `npm install -g wrangler && wrangler login`
 *   3. Save this file as `worker/src/index.ts` in a new wrangler project
 *      (`wrangler init balancesheet-classifier`)
 *   4. Add a secret:
 *        wrangler secret put ANTHROPIC_API_KEY
 *      (paste your key from https://console.anthropic.com/settings/keys)
 *   5. `wrangler deploy` — you'll get a URL like
 *      https://balancesheet-classifier.<your-subdomain>.workers.dev
 *   6. In the NestExpenseTracker repo, set `extra.classifyEndpoint` in
 *      `app.config.js`:
 *
 *        extra: {
 *          ...,
 *          classifyEndpoint: 'https://balancesheet-classifier...workers.dev',
 *        }
 *
 *   7. Re-run `eas update --branch preview --message "wire classify endpoint"`
 *      and reopen the app. From then on, any item the local keyword
 *      classifier marks 'Other' will be sent here for a Claude lookup.
 *
 * Cost: at Haiku 4.5 prices (~$0.25/M input, $1.25/M output) and ~50 input
 * tokens per call, ~10k classifications cost roughly $0.10. Cloudflare
 * Workers' free tier includes 100k requests/day.
 */

interface Env {
  ANTHROPIC_API_KEY: string;
}

export const VALID_CATEGORIES = [
  'Groceries',
  'Electronics',
  'Dining',
  'Pharmacy',
  'Gas',
  'Clothing',
  'Entertainment',
  'Travel',
  'Healthcare',
  'Other',
] as const;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }
    if (request.method !== 'POST') {
      return json({ error: 'POST only' }, 405);
    }

    let body: { name?: string; categories?: string[] };
    try {
      body = await request.json();
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    const sanitized = sanitizeClassifyBody(body);
    if (!sanitized.ok) return json({ error: sanitized.error }, 400);
    const { name, categories } = sanitized;

    const prompt =
      `You categorize a shopping receipt line item into one of these ` +
      `categories: ${categories.join(', ')}. Respond with ONLY the category ` +
      `name, nothing else. Examples:\n` +
      `Item: "ORGANIC MILK 2%" → Groceries\n` +
      `Item: "iPhone Charging Cable" → Electronics\n` +
      `Item: "10LB Neoprene Dumbbell" → Healthcare\n` +
      `Item: "Air Freshener Refill" → Other\n` +
      `Item: "${name}" →`;

    let claudeResp: Response;
    try {
      claudeResp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 16,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
    } catch (e) {
      return json({ error: 'upstream fetch failed', detail: String(e) }, 502);
    }

    if (!claudeResp.ok) {
      const text = await claudeResp.text();
      return json({ error: 'upstream error', status: claudeResp.status, body: text }, 502);
    }
    const data = (await claudeResp.json()) as {
      content?: Array<{ type: string; text: string }>;
    };
    const reply = data.content?.[0]?.text?.trim() ?? '';
    const category = pickCategory(reply, categories);
    return json({ category, name });
  },
};

export function sanitizeClassifyBody(body: {
  name?: string;
  categories?: string[];
}): { ok: true; name: string; categories: string[] } | { ok: false; error: string } {
  const name = (body.name ?? '').trim().slice(0, 200);
  if (!name) return { ok: false, error: 'name required' };
  const categories: string[] = body.categories?.filter((c) =>
    (VALID_CATEGORIES as readonly string[]).includes(c),
  ) ?? [...VALID_CATEGORIES];
  return { ok: true, name, categories };
}

export function pickCategory(reply: string, categories: string[]): string {
  // Prefer an exact-line match, then a case-insensitive substring match.
  const trimmed = reply.replace(/[^A-Za-z]+/g, ' ').trim();
  for (const c of categories) {
    if (new RegExp(`\\b${c}\\b`, 'i').test(trimmed)) return c;
  }
  return 'Other';
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders() },
  });
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
