/**
 * Cloudflare Worker that turns raw receipt OCR text into a structured
 * receipt JSON, using Cloudflare Workers AI as the LLM provider. The
 * NestExpenseTracker app calls this worker as its FREE-FOR-ALL-USERS default
 * AI parser — power users can override by adding their own Gemini key
 * in Settings (which causes the app to bypass this worker and call
 * Google directly).
 *
 * Why this exists:
 *   The Gemini free tier is per-Google-account (1500 RPD), so a public
 *   app sharing one key burns the quota across all users very quickly.
 *   Cloudflare Workers AI has a separate free tier (10,000 neurons/day)
 *   and lets us hold the model and rate-limit logic server-side. The
 *   worker stays free up to ~3000-5000 receipt parses/day, well past
 *   the point where a hobby app might need to pay for inference.
 *
 * Deploy:
 *   1. Sign up at https://dash.cloudflare.com (free, no card)
 *   2. `npm install -g wrangler && wrangler login`
 *   3. `wrangler init balancesheet-parser` in a new directory
 *      - Pick "Hello World Worker"
 *      - Use TypeScript
 *   4. Copy THIS FILE to `src/index.ts` in that project.
 *   5. Edit `wrangler.toml` to add the AI binding:
 *
 *        [ai]
 *        binding = "AI"
 *
 *   6. (Optional but recommended) Set a shared secret so random people
 *      can't hammer your free quota:
 *        wrangler secret put APP_SECRET
 *      (paste any random 32+ char string; the SAME string goes into
 *      the NestExpenseTracker app's PARSE_ENDPOINT_SECRET env var)
 *   7. `wrangler deploy` — note the URL like
 *      https://balancesheet-parser.<your-subdomain>.workers.dev
 *   8. In the NestExpenseTracker repo, set EAS env vars on the preview profile:
 *
 *        eas env:create --environment preview --name PARSE_ENDPOINT \
 *            --value 'https://balancesheet-parser.<sub>.workers.dev/parse'
 *        eas env:create --environment preview --name PARSE_ENDPOINT_SECRET \
 *            --value '<the same APP_SECRET from step 6>'
 *
 *   9. Re-publish OTA:  `eas update --branch preview --environment preview`
 *
 * Cost: Cloudflare Workers free plan gives 100k requests/day to the
 * Worker itself, and Workers AI free tier gives 10k neurons/day. Llama
 * 3.3 70B uses ~30-40 neurons per typical receipt parse, so the free
 * tier covers ~250-300 parses/day. For higher volume, switch the MODEL
 * constant below to `@cf/meta/llama-3.1-8b-instruct` (~5 neurons each,
 * ~2000 parses/day free) or upgrade to the paid Workers AI plan.
 */

// Same standard categories the app expects. Must stay in sync with
// constants/categories.ts on the app side.
const ALL_CATEGORIES = [
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

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Simple per-IP rate limit. Cloudflare gives us the connecting IP on
// every request; we keep a tiny in-memory map of (ip → window count)
// scoped to one Worker isolate. This is best-effort (different isolates
// see different counts), but combined with the global free-tier ceiling
// it's enough to discourage abuse. For stricter limits, swap to KV.
const RATE_LIMIT = { windowMs: 60_000, maxRequests: 10 };
const ipCounts = new Map<string, { count: number; resetAt: number }>();

/** Best-effort per-isolate cap. `now` is injectable so tests stay deterministic. */
export function shouldRateLimit(ip: string, now = Date.now()): boolean {
  const entry = ipCounts.get(ip);
  if (!entry || now > entry.resetAt) {
    ipCounts.set(ip, { count: 1, resetAt: now + RATE_LIMIT.windowMs });
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT.maxRequests;
}

export function resetParseRateLimitForTests(): void {
  ipCounts.clear();
}

interface Env {
  AI: {
    run: (
      model: string,
      input: {
        messages: Array<{ role: 'system' | 'user'; content: string }>;
        max_tokens?: number;
        temperature?: number;
        response_format?: { type: 'json_object' | 'json_schema'; json_schema?: unknown };
      },
    ) => Promise<{ response?: string }>;
  };
  APP_SECRET?: string;
}

interface ParseRequestBody {
  rawText?: string;
  examples?: Array<{
    rawOcr: string;
    items: Array<{ name: string; amount: number; category?: string }>;
  }>;
}

const SYSTEM_PROMPT = `You are a receipt parser. Read OCR text from a shopping receipt and return STRICT JSON with the schema described below. Never include any preamble or explanation — output a single JSON object only.

Schema:
{
  "store": string,
  "date": string,           // YYYY-MM-DD or "" if not findable
  "subtotal": number|null,
  "tax": number|null,
  "total": number,
  "categoryTags": string[], // 1-4 tags
  "items": [
    { "name": string, "amount": number, "category": string }
  ]
}

Rules for ITEMS:
- Emit ONE item per PHYSICAL PRODUCT the customer is paying for, at the NET price they actually paid.
- If the receipt has a "New Price: $X" line directly under a product, use $X.
- If a discount/markdown line is attached to a product (negative number "$15.00-" or "-15.00" or "($52.50)", or a "TPD/{SKU}" reference), subtract it from the printed price.
- Items MUST sum to subtotal within $0.50 — re-check pairings before responding.
- Strip 8-14 digit UPC/SKU prefixes from item names.
- Strip trailing tax-status letters (H, J, D, E, T).
- Each item's category MUST be one of the receipt's categoryTags. Decide categoryTags first, then assign every item to one of those tags. If an item doesn't fit any tag, use "Other". Allowed STANDARD tags: ${ALL_CATEGORIES.join(', ')} — plus any specific custom labels you choose (e.g. "Footwear", "Pet Food", "Home Decor"). Items should NEVER use a category that isn't in categoryTags.

Skip metadata rows attached to items: "Style: ...", "Size: 8 Color: BLACK", "BOGO 50% Off" (even with $0.00), "New Price: $...", "TPD/{SKU}", "You Saved $...", "Items Sold: N", "Items Returned: N".

Skip payment/EMV/header noise: SUBTOTAL, TAX, TOTAL, AMOUNT, BALANCE, CHANGE, TENDER, Sequence Number, Approval Code, AID/TVR/TSI/IAD/ARC/ACI/ISO/Application Cryptogram lines, masked card numbers (XXXXX0875), postal codes, phone numbers, addresses, store IDs, "Verified by PIN".

Date formats: "2025-08-31", "08/31/2025", "31/08/2025" (Euro), "2025/08/31", "Aug 31, 2025", "31 Aug 2025" — always normalize to YYYY-MM-DD.

categoryTags MAY be standard categories OR custom labels ("Pet Food", "Home Decor", "Footwear", "Office Supplies"). Keep tags short (1-3 words). 1-4 tags total.

EXAMPLE — Skechers BOGO 50%:
OCR:
    197627156231 UNO - SUITED ON AIR $110.00T
    BOGO 50% Off Footwear $0.00
    New Price: $110.00
    197976255623 ON-THE-GO FLEX - CO $104.99T
    Size: 8 Color: NVY/WHT ($52.50)
    New Price: $52.49
Output categoryTags: ["Footwear"]
Output items:
    [
      {"name": "UNO - SUITED ON AIR", "amount": 110.00, "category": "Footwear"},
      {"name": "ON-THE-GO FLEX - CO", "amount": 52.49, "category": "Footwear"}
    ]
(Items use the custom "Footwear" tag, matching categoryTags. Don't pick "Clothing" here.)

EXAMPLE — Costco multi-category trip:
OCR:
    1420528 VEGGIES PK 4 14.99 H
    1993379 EKO MIRROR 69.99 H
    2067431 TPD/1993379 15.00- H
Output categoryTags: ["Groceries", "Home Decor"]
Output items:
    [
      {"name": "VEGGIES PK 4", "amount": 14.99, "category": "Groceries"},
      {"name": "EKO MIRROR", "amount": 54.99, "category": "Home Decor"}
    ]
(Each item is assigned to whichever categoryTag it belongs to.)

EXAMPLE — Grocery receipt with embedded discount + unused multi-buy deals (Panchvati-style):
OCR:
    Bingo Tedhe Meche Masala     $1.49 P
    80g
    3 For $4
    Pvs Calcutta Paan 250g
       2 @ $3.99                $7.98
            Pvs Mukhwas 250 G   -$2.98
    Rajnigandha Silver Pearls   $3.99 P
    Pvs Coriander Seeds 200g    $3.49
    Kur Masala Munch 100g       $1.49 P
    3 For $4.00
    Uncle Chips Spicy Treat 60g $1.49 P
    2 For $1.00
    Fresh Roti Jumbo 10pcs      $6.99 F
    SUB-TOTAL                   $26.94
    TOTAL                       $28.50
Output categoryTags: ["Groceries"]
Output items:
    [
      {"name": "Bingo Tedhe Meche Masala 80g",    "amount": 1.49, "category": "Groceries"},
      {"name": "Pvs Calcutta Paan 250g",          "amount": 5.00, "category": "Groceries"},
      {"name": "Rajnigandha Silver Pearls",       "amount": 3.99, "category": "Groceries"},
      {"name": "Pvs Coriander Seeds 200g",        "amount": 3.49, "category": "Groceries"},
      {"name": "Kur Masala Munch 100g",           "amount": 1.49, "category": "Groceries"},
      {"name": "Uncle Chips Spicy Treat 60g",     "amount": 1.49, "category": "Groceries"},
      {"name": "Fresh Roti Jumbo 10pcs",          "amount": 6.99, "category": "Groceries"}
    ]
(CRITICAL behaviours demonstrated by this example, applied in this order:
 1. "X For $Y" promo qualifiers ("3 For $4", "3 For $4.00", "2 For $1.00") are MARKETING TEXT for an unused deal — the customer paid the PRINTED line price ($1.49, $1.49, $1.49), not the deal price. NEVER divide the deal price by the deal quantity. Skip these lines entirely.
 2. Weight/size sub-lines like "80g" attribute to the product directly above — fold the weight into the product name. Don't emit "80g" as its own item.
 3. "N @ $X.YZ $W.WW" lines (Calcutta) are quantity-rate breakdowns: N units at $X.YZ each totals $W.WW. The product paid $W.WW, NOT $X.YZ.
 4. A negative-amount sub-line under a product ("Pvs Mukhwas 250 G  -$2.98" indented under Calcutta) is a discount attached to the PARENT product, not a separate item. Subtract it from the parent: 7.98 − 2.98 = 5.00. Do NOT emit the discount line as its own item.
 5. When you skip ANY line above, the REMAINING product names must stay paired with THEIR OWN row's price. Never shift names up to fill the gap a skipped line leaves in the price column.)
`;

export function buildUserPrompt(rawText: string, examples: ParseRequestBody['examples']): string {
  const truncated = rawText.length > 8000 ? rawText.slice(0, 8000) : rawText;
  let prefix = '';
  if (examples && examples.length > 0) {
    const blocks = examples
      .filter((e) => e.items && e.items.length > 0)
      .slice(0, 2)
      .map((e, idx) => {
        const ocr = e.rawOcr.slice(0, 1500).trim();
        return `USER-CORRECTED EXAMPLE ${idx + 1} (from this user's prior scan of this store):\nOCR fragment:\n${ocr}\nCorrect items:\n${JSON.stringify(e.items, null, 2)}`;
      });
    if (blocks.length > 0) prefix = blocks.join('\n\n') + '\n\n';
  }
  return `${prefix}Receipt OCR text:\n"""\n${truncated}\n"""`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405);

    const url = new URL(request.url);
    if (url.pathname !== '/parse' && url.pathname !== '/') {
      return json({ error: 'unknown endpoint' }, 404);
    }

    // Shared-secret check (when APP_SECRET is set). Stops random people
    // who scrape the worker URL from burning your free quota.
    if (env.APP_SECRET) {
      const provided = request.headers.get('x-app-secret') ?? '';
      if (provided !== env.APP_SECRET) {
        return json({ error: 'unauthorized' }, 401);
      }
    }

    const ip = request.headers.get('cf-connecting-ip') ?? 'unknown';
    if (shouldRateLimit(ip)) {
      return json({ error: 'rate-limited' }, 429);
    }

    let body: ParseRequestBody;
    try {
      body = (await request.json()) as ParseRequestBody;
    } catch {
      return json({ error: 'invalid JSON' }, 400);
    }
    const rawText = (body.rawText ?? '').trim();
    if (!rawText) return json({ error: 'rawText required' }, 400);

    const userPrompt = buildUserPrompt(rawText, body.examples);

    let aiResp: { response?: string };
    try {
      aiResp = await env.AI.run(MODEL, {
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 2048,
        temperature: 0,
        response_format: { type: 'json_object' },
      });
    } catch (e) {
      return json({ error: 'upstream-error', detail: String(e) }, 502);
    }

    const raw = (aiResp.response ?? '').trim();
    if (!raw) return json({ error: 'empty-response' }, 502);

    // Some Workers AI models wrap their JSON in markdown fences or
    // chat-style preamble; strip both before parsing.
    const cleaned = stripAiJsonFence(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return json({ error: 'parse-failed', detail: String(e), raw: cleaned.slice(0, 500) }, 502);
    }

    // Forward the parsed JSON unchanged. The app's parseGeminiPayload
    // already validates the shape, coerces numeric strings, falls back
    // unknown categories to "Other", and runs the discount-line merge.
    return json(parsed);
  },
};

/** Strip a ``` / ```json wrapper so JSON.parse sees the object. */
export function stripAiJsonFence(raw: string): string {
  return raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
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
    'Access-Control-Allow-Headers': 'Content-Type, x-app-secret',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}
