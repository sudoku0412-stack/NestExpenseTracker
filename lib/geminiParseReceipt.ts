import { Category, LineItem } from '../types';
import { ALL_CATEGORIES } from '../constants/categories';
import { mergeDiscountLines } from './parser';

// Gemini 2.5 Flash with structured-JSON output. Free-tier-friendly and
// dramatically more robust than regex for messy phone-camera OCR.
const MODEL = 'gemini-2.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type GeminiReceipt = {
  storeName: string;
  /** ISO timestamp string, e.g. "2025-08-31T04:00:00.000Z". Built
   *  from the receipt's wall-clock date interpreted in LOCAL time so
   *  round-trips through `format(..., "yyyy-MM-dd")` (which also uses
   *  local time) preserve the date the user saw on the receipt. */
  date: string;
  subtotalAmount?: number;
  taxAmount?: number;
  totalAmount: number;
  lineItems: LineItem[];
  /** Multi-select tags for the receipt as a whole. May include the
   *  standard 10 category names AND custom tags Gemini suggests
   *  (e.g. "Pet Food", "Home Decor"). 1-4 tags typical. */
  categoryTags: string[];
};

/** A reason code we surface to the UI so it can pick the right copy
 *  and decide whether to auto-retry. */
export type GeminiErrorKind =
  | 'no-key'
  | 'network'
  | 'rate-limited'
  | 'auth'
  | 'server'
  | 'parse'
  | 'empty'
  | 'unknown'
  // Not a real Gemini/backend error — set locally in scan.tsx when the
  // free-tier monthly AI-parse quota (lib/secureStorage.ts) is used up
  // and the user isn't Premium. Kept in this union so aiErrorMessage's
  // switch stays exhaustive-by-convention with the rest of the kinds.
  | 'quota';

export type GeminiParseResult =
  | { ok: true; receipt: GeminiReceipt }
  | { ok: false; kind: GeminiErrorKind; error: string };

const PROMPT = `You are a receipt parser. Extract structured data from the receipt OCR text below.

Rules for ITEMS:
- CRITICAL: emit ONE line item per PHYSICAL PRODUCT the customer is paying for, at the NET PRICE they actually paid for that product. Never emit standalone discount/promo lines, never emit metadata lines, never emit lines with a $0.00 amount.
- Determining the NET PRICE — apply these rules to each product, in order:
    1. If the same product has an explicit "New Price: $X" line directly below it, use $X.
    2. Otherwise, if there's a discount line attached to that product — written as a negative number ("$15.00-", "-15.00", or "($52.50)"), or as a "TPD/{SKU}" line referencing the product's SKU — subtract that discount from the printed price and use the result.
    3. Otherwise use the price printed on the product's name row.
- The item amounts must SUM to the SUBTOTAL (within $0.50 of rounding). If they don't, you've made a pairing or discount mistake — re-read the receipt and fix it before responding. This is a hard requirement.
- Pair every item NAME with the price that appears on the SAME receipt row. Read top to bottom, row by row. If OCR returns names and prices in two parallel columns, treat them as parallel arrays: name[i] ↔ price[i]. Do not shift, sort, or rearrange.
- Strip 8-14 digit UPC/SKU codes and leading numeric item codes from names (e.g. "1420528 VEGGIES PK 4" → "VEGGIES PK 4", "197627156231 UNO - SUITED ON AIR" → "UNO - SUITED ON AIR").
- Strip the trailing single-letter tax-status flag (e.g. "H", "J", "D", "E", "T") from item names.
- Many receipts print one product across MULTIPLE OCR rows. The first row has the NAME and PRICE; the next rows have METADATA. Attribute metadata to the previous product — do NOT emit them as separate items. Always skip:
    "Style: 183004BLK", "Size: 8 Color: BLACK"
    "BOGO 50% Off Footwear" (even when it has a "$0.00" on the same line — that $0.00 is a discount placeholder for the "buy" item in a buy-one-get-one, NOT a product price)
    "New Price: $X"          (a SUMMARY of the net price you computed above)
    "TPD/{SKU}"              (a TPD/markdown reference — its negative amount is the discount for the SKU it references)
    "You Saved $X"           (receipt-level savings summary)
    "Items Sold: N", "Items Returned: N"
- Do NOT include these as items either — they are payment / EMV / header noise:
    SUBTOTAL, TAX, TOTAL, AMOUNT, BALANCE, CHANGE, TENDER, AMOUNT TENDERED
    Transaction IDs: STORE / ST / OP / TE / TR / TRM / WHSE / INVOICE, Sequence Number, Approval Code, Assoc/Reg/Tran
    Bank/EMV codes: RRN, AID, TC, AUTH, REFERENCE, APPROVAL, TVR, TSI, IAD, ARC, ACI, ISO, Application Cryptogram/Preferred Name/Label
    Costco markers: "Bottom of basket", "BOB Count", "ZV Member", "Member #", "Membership"
    Masked card numbers (mostly X's, e.g. "XXXXXXXXXXXX0933")
    Postal codes, phone numbers, store address lines, tax footnotes ("H = HST G = GST")
    Signature / approval status lines, "Verified by PIN"
- For each item's category, FIRST decide the receipt-level categoryTags (see Rules for FIELDS below), then assign EVERY item to ONE of those categoryTags. This keeps the per-item categorization in sync with the receipt's overall classification.
  - If categoryTags is ["Footwear", "Other"], items must be either "Footwear" or "Other" — not "Clothing".
  - If categoryTags is just standard categories like ["Groceries", "Pharmacy"], items must be one of those.
  - If an item doesn't fit any of the chosen categoryTags, use "Other".
  - DO NOT pick a category for an item that isn't in categoryTags. Pick the closest tag instead.

Allowed STANDARD categories (you can use these AND/OR custom tags): ${ALL_CATEGORIES.join(', ')}. Mapping cheatsheet: Footwear/apparel → use a "Footwear"/"Clothing" custom tag if specific, else "Clothing". Shoe care/polish/laces → "Other". Restaurant food/coffee → "Dining". Fuel → "Gas". Prescription drugs → "Pharmacy".

EXAMPLE 1 — BOGO 50% Off (Skechers-style):
OCR fragment:
    197627156231 UNO - SUITED ON AIR $110.00T
    Style: 183004BLK
    Size: 8 Color: BLACK
    BOGO 50% Off Footwear $0.00
    New Price: $110.00
    197976255623 ON-THE-GO FLEX - CO $104.99T
    Style: 138215NVW
    Size: 8 Color: NVY/WHT ($52.50)
    BOGO 50% Off Footwear
    New Price: $52.49
Correct categoryTags: ["Footwear"]
Correct items:
    { "name": "UNO - SUITED ON AIR",    "amount": 110.00, "category": "Footwear" }
    { "name": "ON-THE-GO FLEX - CO",    "amount": 52.49,  "category": "Footwear" }
(Items use the CUSTOM "Footwear" tag, not the broader standard "Clothing", because Footwear was picked as a receipt-level tag. One line per shoe. The first shoe's "$0.00" BOGO line is a placeholder; the second shoe's "($52.50)" is the discount, so its net = 104.99 − 52.50 = 52.49 which matches the printed "New Price: $52.49".)

EXAMPLE 2 — Costco multi-category trip with TPD markdown:
OCR fragment:
    1420528 VEGGIES PK 4 14.99 H
    1993379 EKO MIRROR 69.99 H
    2067431 TPD/1993379 15.00- H
    313963 KS ORG EGGS 12.49
Correct categoryTags: ["Groceries", "Home Decor"]
Correct items:
    { "name": "VEGGIES PK 4", "amount": 14.99, "category": "Groceries" }
    { "name": "EKO MIRROR",   "amount": 54.99, "category": "Home Decor" }
    { "name": "KS ORG EGGS",  "amount": 12.49, "category": "Groceries" }
(EKO MIRROR uses the custom "Home Decor" tag (the receipt has TWO categoryTags so each item picks the one it belongs to). The TPD/1993379 line is the markdown for SKU 1993379. Net = 69.99 − 15.00 = 54.99. Emit ONE line per product at the net price; do NOT emit the TPD line as a separate item.)

EXAMPLE 3 — Grocery receipt with embedded discount + unused multi-buy deals:
OCR fragment:
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
Correct categoryTags: ["Groceries"]
Correct items:
    { "name": "Bingo Tedhe Meche Masala 80g",    "amount": 1.49, "category": "Groceries" }
    { "name": "Pvs Calcutta Paan 250g",          "amount": 5.00, "category": "Groceries" }
    { "name": "Rajnigandha Silver Pearls",       "amount": 3.99, "category": "Groceries" }
    { "name": "Pvs Coriander Seeds 200g",        "amount": 3.49, "category": "Groceries" }
    { "name": "Kur Masala Munch 100g",           "amount": 1.49, "category": "Groceries" }
    { "name": "Uncle Chips Spicy Treat 60g",     "amount": 1.49, "category": "Groceries" }
    { "name": "Fresh Roti Jumbo 10pcs",          "amount": 6.99, "category": "Groceries" }
(CRITICAL behaviours, applied in this order:
 1. "X For $Y" promo qualifiers ("3 For $4", "3 For $4.00", "2 For $1.00") are MARKETING TEXT for an unused deal — the customer paid the PRINTED line price ($1.49 each), not the deal price. NEVER divide a deal price by the deal quantity. Skip these lines entirely.
 2. Weight/size sub-lines like "80g" attribute to the product directly above — fold the weight into the product name. Don't emit "80g" as its own item.
 3. "N @ $X.YZ $W.WW" lines (Calcutta's "2 @ $3.99 $7.98") are quantity-rate breakdowns: N units at $X.YZ each totals $W.WW. The product paid $W.WW, NOT $X.YZ.
 4. A negative-amount sub-line under a product ("Pvs Mukhwas 250 G -$2.98" indented under Calcutta) is a DISCOUNT attached to the parent product, not a separate item. Subtract it from the parent: 7.98 − 2.98 = 5.00. Do NOT emit the discount line as its own item.
 5. When you skip ANY line above, the REMAINING product names must stay paired with THEIR OWN row's price. Never shift names up to fill the gap a skipped line leaves in the price column.)

Rules for FIELDS:
- store: the merchant name, cleaned of OCR garbage characters and casing weirdness.
- date: the transaction date printed on the receipt. ALWAYS look for it — most receipts have one near the top header, the bottom footer, or next to "Date:", "Trans:", "Order:". Format as YYYY-MM-DD. Recognize all of: "2025-08-31", "08/31/2025", "31/08/2025", "2025/08/31", "Aug 31, 2025", "31 Aug 2025". Only return an empty string if NO date appears anywhere on the receipt.
- subtotal / tax: use null if not present on the receipt. The subtotal is the sum BEFORE tax. The tax is the GST/HST/PST/sales-tax amount. Don't confuse them.
- total: the grand total the customer paid.
- categoryTags: 1 to 4 tags for the WHOLE receipt. Each tag MAY be one of the standard categories (${ALL_CATEGORIES.join(', ')}) OR a more specific custom tag like "Pet Food", "Home Decor", "Office Supplies", "Auto Parts", "Baby Care", "Sports Gear", etc. — whatever fits the receipt content best. Keep tags short (1-3 words). For a receipt that spans multiple types of items, include multiple tags.

Allowed categories for individual line items (use EXACTLY one of these, no custom values for items): ${ALL_CATEGORIES.join(', ')}.`;

const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    store: { type: 'string' },
    date: { type: 'string' },
    subtotal: { type: 'number', nullable: true },
    tax: { type: 'number', nullable: true },
    total: { type: 'number' },
    categoryTags: {
      type: 'array',
      items: { type: 'string' },
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          amount: { type: 'number' },
          // Category is a free-form string, not enum-restricted. Items
          // should ideally use one of the receipt-level categoryTags
          // (which may include custom labels like "Footwear" or "Pet
          // Food"), falling back to one of the standard 10 categories.
          // The prompt enforces this convention; the schema stays open
          // so custom tags aren't silently dropped by the JSON validator.
          category: { type: 'string' },
        },
        required: ['name', 'amount', 'category'],
      },
    },
  },
  required: ['store', 'total', 'items'],
};

/** A prior user-saved correction we can inject as an in-context
 *  example so Gemini "learns" how the user wants their receipts
 *  parsed. Provided by lib/database#getRelevantCorrections. */
export type CorrectionExample = {
  rawOcr: string;
  items: Array<{ name: string; amount: number; category?: string }>;
};

/**
 * Render up to N prior user-corrections as additional in-context
 * examples appended to the static prompt. Each example shows the AI
 * the OCR text the user saw + the final items they actually saved,
 * which encodes both the merchant-specific layout and the user's
 * naming/categorization preferences. We cap each example's OCR at
 * ~1.5KB and skip examples without items.
 */
export function formatExamples(examples: CorrectionExample[]): string {
  const useful = examples.filter((e) => e.items.length > 0).slice(0, 3);
  if (useful.length === 0) return '';
  const blocks = useful.map((ex, idx) => {
    const ocr = ex.rawOcr.slice(0, 1500).trim();
    const items = ex.items.map((it) => ({
      name: it.name,
      amount: it.amount,
      category: it.category ?? 'Other',
    }));
    return `EXAMPLE ${idx + 3} — from this user's prior scan of this store:\nOCR fragment:\n${ocr}\nCorrect items:\n${JSON.stringify(items, null, 2)}`;
  });
  return `\n\n${blocks.join('\n\n')}`;
}

/**
 * Send the OCR text to Gemini 2.5 Flash with a structured-JSON response
 * schema. Gemini extracts a clean { store, date, subtotal, tax, total,
 * items } payload that handles two-column receipts, lowercase tax
 * letters, header noise, postal codes, and other quirks the regex
 * parser struggles with.
 *
 * Pass `examples` (typically the user's most recent corrected scans
 * from the same store) to add few-shot in-context learning — the
 * model is much more likely to follow the user's preferred item
 * naming and category assignments after seeing 1-2 worked examples.
 */
export async function parseReceiptWithGemini(
  rawText: string,
  apiKey: string,
  signal?: AbortSignal,
  examples: CorrectionExample[] = [],
): Promise<GeminiParseResult> {
  if (!apiKey || !rawText.trim()) {
    return { ok: false, kind: 'no-key', error: 'missing key or text' };
  }

  // Cap input at ~8000 chars (~2k tokens) — even the longest receipts
  // fit, and this prevents pathological OCR from eating up tokens.
  const truncated = rawText.length > 8000 ? rawText.slice(0, 8000) : rawText;
  // Splice user-correction examples (if any) BEFORE the OCR block so
  // the model has seen them as part of its reasoning context when it
  // gets to the actual receipt.
  const examplesBlock = formatExamples(examples);
  const prompt = `${PROMPT}${examplesBlock}\n\nReceipt OCR text:\n"""\n${truncated}\n"""`;

  let resp: Response;
  try {
    resp = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: RESPONSE_SCHEMA,
          temperature: 0,
          maxOutputTokens: 4096,
          // Gemini 2.5 Flash spends most of its output budget on
          // internal "thinking" tokens by default — for a structured-
          // JSON receipt parse that's pure overhead, and on a long
          // receipt it consumes the entire 4096 before any JSON is
          // emitted, returning a truncated reply (finishReason
          // MAX_TOKENS) that fails to parse. Disable thinking so the
          // full budget goes to the actual JSON output.
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
      signal,
    });
  } catch (e) {
    return {
      ok: false,
      kind: 'network',
      error: `network: ${(e as Error)?.message ?? 'unknown'}`,
    };
  }

  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const kind: GeminiErrorKind =
      resp.status === 429
        ? 'rate-limited'
        : resp.status === 401 || resp.status === 403
          ? 'auth'
          : resp.status >= 500
            ? 'server'
            : 'unknown';
    return {
      ok: false,
      kind,
      error: `http ${resp.status}: ${body.slice(0, 300)}`,
    };
  }

  let envelope: {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  try {
    envelope = await resp.json();
  } catch (e) {
    return {
      ok: false,
      kind: 'parse',
      error: `parse envelope: ${(e as Error)?.message}`,
    };
  }

  const text = envelope.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) return { ok: false, kind: 'empty', error: 'empty response' };
  return parseGeminiPayload(text);
}

/**
 * Validate and convert Gemini's JSON reply into a typed GeminiReceipt.
 * Tolerant of small drift (numeric strings, missing fields, unknown
 * categories — all coerced or fallbacked).
 */
/** Models sometimes wrap JSON in markdown fences or a short preamble. */
export function coerceJsonText(jsonText: string): string {
  const trimmed = jsonText.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim();
  if (trimmed.startsWith('{')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

export function parseGeminiPayload(jsonText: string): GeminiParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(coerceJsonText(jsonText));
  } catch (e) {
    return {
      ok: false,
      kind: 'parse',
      error: `parse json: ${(e as Error)?.message}`,
    };
  }
  const obj = raw as Record<string, unknown> | null;
  if (!obj || typeof obj !== 'object') {
    return { ok: false, kind: 'parse', error: 'reply was not an object' };
  }

  const store = typeof obj.store === 'string' ? obj.store.trim() : '';
  const date = typeof obj.date === 'string' ? obj.date.trim() : '';
  const total = toFiniteNumber(obj.total);
  const subtotal = toFiniteNumber(obj.subtotal);
  const tax = toFiniteNumber(obj.tax);

  const itemsRaw = Array.isArray(obj.items) ? obj.items : [];
  const items: LineItem[] = [];
  for (const it of itemsRaw) {
    if (!it || typeof it !== 'object') continue;
    const i = it as Record<string, unknown>;
    const name = typeof i.name === 'string' ? i.name.trim() : '';
    const amount = toFiniteNumber(i.amount);
    if (!name || amount == null) continue;
    // Accept ANY non-empty string for item category — most should be
    // one of the 10 standard categories, but specific custom tags
    // (e.g. "Footwear", "Pet Food") are now allowed so per-item
    // categorization stays consistent with the receipt's categoryTags.
    // Fall back to 'Other' only when the field is missing or blank.
    const rawCategory =
      typeof i.category === 'string' ? i.category.trim() : '';
    const category = rawCategory.length > 0 ? rawCategory : 'Other';
    items.push({
      id: Math.random().toString(36).slice(2, 9),
      name,
      amount,
      category,
    });
  }

  // Tag list — accept any short non-empty strings up to 4. If the model
  // omitted them, fall back to the unique categories among the items.
  let tags: string[] = [];
  if (Array.isArray(obj.categoryTags)) {
    for (const t of obj.categoryTags) {
      if (typeof t !== 'string') continue;
      const trimmed = t.trim();
      if (!trimmed || trimmed.length > 32) continue;
      if (!tags.includes(trimmed)) tags.push(trimmed);
      if (tags.length >= 6) break;
    }
  }
  if (tags.length === 0) {
    const seen = new Set<string>();
    for (const it of items) if (it.category) seen.add(it.category);
    tags = Array.from(seen);
  }

  // Fold any negative discount / markdown lines into the item they
  // apply to — same merge pass as the regex parser so the rest of the
  // app (dashboard, drilldown) sees a clean one-row-per-product list.
  const mergedItems = mergeDiscountLines(items);

  return {
    ok: true,
    receipt: {
      storeName: store || 'Unknown Store',
      date: isoDateOrEmpty(date),
      subtotalAmount: subtotal ?? undefined,
      taxAmount: tax ?? undefined,
      totalAmount: total ?? 0,
      lineItems: mergedItems,
      categoryTags: tags,
    },
  };
}

function toFiniteNumber(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function isoDateOrEmpty(date: string): string {
  if (!date) return new Date().toISOString();
  // Accept YYYY-MM-DD; tolerate YYYY/MM/DD too. Construct the Date in
  // LOCAL time so the wall-clock date the user sees on the receipt
  // survives downstream `format(...)` calls (which use local time).
  // Using "...T00:00:00.000Z" here would force UTC midnight and
  // negative-offset users would see the previous day after format().
  const m = date.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!m) return new Date().toISOString();
  const d = new Date(
    parseInt(m[1], 10),
    parseInt(m[2], 10) - 1,
    parseInt(m[3], 10),
  );
  return Number.isFinite(d.getTime()) ? d.toISOString() : new Date().toISOString();
}
