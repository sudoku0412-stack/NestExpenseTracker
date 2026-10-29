import {
  parseGeminiPayload,
  parseReceiptWithGemini,
  formatExamples,
} from '../lib/geminiParseReceipt';

describe('parseGeminiPayload — validating Gemini JSON receipt response', () => {
  it('parses a valid full receipt response', () => {
    const json = JSON.stringify({
      store: 'Walmart',
      date: '2026-05-09',
      subtotal: 114.04,
      tax: 13.56,
      total: 127.6,
      items: [
        { name: '10LB NEOPREN', amount: 14.97, category: 'Healthcare' },
        { name: '5LB RUBBER', amount: 9.98, category: 'Healthcare' },
        { name: 'TB CHC CROIS', amount: 5.98, category: 'Groceries' },
      ],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const r = result.receipt;
    expect(r.storeName).toBe('Walmart');
    expect(r.totalAmount).toBe(127.6);
    expect(r.subtotalAmount).toBe(114.04);
    expect(r.taxAmount).toBe(13.56);
    expect(r.lineItems.length).toBe(3);
    expect(r.lineItems[0].name).toBe('10LB NEOPREN');
    expect(r.lineItems[0].amount).toBe(14.97);
    expect(r.lineItems[0].category).toBe('Healthcare');
  });

  it('handles null subtotal/tax (receipt without those lines)', () => {
    const json = JSON.stringify({
      store: 'Coffee Shop',
      date: '',
      subtotal: null,
      tax: null,
      total: 5.5,
      items: [{ name: 'Latte', amount: 5.5, category: 'Dining' }],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.subtotalAmount).toBeUndefined();
    expect(result.receipt.taxAmount).toBeUndefined();
  });

  it('skips items missing required fields', () => {
    const json = JSON.stringify({
      store: 'X',
      total: 10,
      items: [
        { name: 'Valid', amount: 10, category: 'Other' },
        { name: '', amount: 1, category: 'Other' }, // empty name → skip
        { name: 'No amount', category: 'Other' }, // missing amount → skip
        { amount: 5, category: 'Other' }, // missing name → skip
      ],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.lineItems.length).toBe(1);
    expect(result.receipt.lineItems[0].name).toBe('Valid');
  });

  it('preserves a non-standard category string (custom receipt tag like "Footwear")', () => {
    // Non-standard categories are now allowed on line items so they
    // can mirror the receipt-level categoryTags (e.g. "Footwear" on a
    // Skechers receipt instead of the broader standard "Clothing").
    const json = JSON.stringify({
      store: 'Skechers',
      total: 110,
      categoryTags: ['Footwear'],
      items: [{ name: 'UNO - SUITED ON AIR', amount: 110, category: 'Footwear' }],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.lineItems[0].category).toBe('Footwear');
  });

  it('preserves the wall-clock date across timezones', () => {
    // Regression: isoDateOrEmpty used to build "YYYY-MM-DDT00:00:00.000Z"
    // (UTC midnight), so users in negative-offset timezones saw the
    // previous day after format(). Now the (y, m, d) ctor is used so
    // local time is preserved and the receipt date survives.
    const json = JSON.stringify({
      store: 'X',
      date: '2025-08-31',
      total: 10,
      items: [{ name: 'A', amount: 10, category: 'Other' }],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = new Date(result.receipt.date);
    expect(d.getFullYear()).toBe(2025);
    expect(d.getMonth()).toBe(7); // August
    expect(d.getDate()).toBe(31);
  });

  it('falls back to Other when item category is missing or empty', () => {
    const json = JSON.stringify({
      store: 'X',
      total: 10,
      items: [
        { name: 'No category', amount: 10 },
        { name: 'Empty string', amount: 10, category: '' },
        { name: 'Whitespace only', amount: 10, category: '   ' },
      ],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.lineItems.every((i) => i.category === 'Other')).toBe(true);
  });

  it('coerces numeric strings to numbers', () => {
    const json = JSON.stringify({
      store: 'X',
      total: '127.60',
      subtotal: '114.04',
      tax: '13.56',
      items: [{ name: 'Item', amount: '14.97', category: 'Other' }],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.totalAmount).toBe(127.6);
    expect(result.receipt.subtotalAmount).toBe(114.04);
    expect(result.receipt.lineItems[0].amount).toBe(14.97);
  });

  it('returns ok=false on invalid JSON', () => {
    const result = parseGeminiPayload('not valid json{');
    expect(result.ok).toBe(false);
  });

  it('returns ok=false on non-object reply', () => {
    const result = parseGeminiPayload('"just a string"');
    expect(result.ok).toBe(false);
  });

  it('uses fallback storeName when missing', () => {
    const json = JSON.stringify({ total: 10, items: [] });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.storeName).toBe('Unknown Store');
  });

  it('falls back to today when date is invalid', () => {
    const json = JSON.stringify({
      store: 'X',
      date: 'not a date',
      total: 10,
      items: [],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Should be a valid ISO date string (today)
    expect(() => new Date(result.receipt.date).toISOString()).not.toThrow();
  });

  it('handles empty items array', () => {
    const json = JSON.stringify({ store: 'X', total: 0, items: [] });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.lineItems).toEqual([]);
  });

  describe('categoryTags', () => {
    it('preserves tags Gemini returned, trimmed and deduped', () => {
      const json = JSON.stringify({
        store: 'X',
        total: 10,
        categoryTags: ['Groceries', '  Pet Food  ', 'Groceries', 'Home Decor'],
        items: [],
      });
      const r = parseGeminiPayload(json);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.receipt.categoryTags).toEqual(['Groceries', 'Pet Food', 'Home Decor']);
    });

    it('rejects tags that are too long', () => {
      const json = JSON.stringify({
        store: 'X',
        total: 10,
        categoryTags: ['Groceries', 'a'.repeat(40)],
        items: [],
      });
      const r = parseGeminiPayload(json);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.receipt.categoryTags).toEqual(['Groceries']);
    });

    it('caps tag count at 6 to keep UI manageable', () => {
      const json = JSON.stringify({
        store: 'X',
        total: 10,
        categoryTags: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
        items: [],
      });
      const r = parseGeminiPayload(json);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.receipt.categoryTags.length).toBe(6);
    });

    it('falls back to unique item categories when categoryTags is missing', () => {
      const json = JSON.stringify({
        store: 'X',
        total: 10,
        items: [
          { name: 'Apple', amount: 1, category: 'Groceries' },
          { name: 'Charger', amount: 9, category: 'Electronics' },
        ],
      });
      const r = parseGeminiPayload(json);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.receipt.categoryTags.sort()).toEqual(['Electronics', 'Groceries']);
    });

    it('accepts both standard and custom strings', () => {
      const json = JSON.stringify({
        store: 'PetSmart',
        total: 50,
        categoryTags: ['Other', 'Pet Food', 'Pet Toys'],
        items: [],
      });
      const r = parseGeminiPayload(json);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.receipt.categoryTags).toEqual(['Other', 'Pet Food', 'Pet Toys']);
    });
  });

  it('accepts YYYY/MM/DD dates as local wall-clock dates', () => {
    const json = JSON.stringify({
      store: 'X',
      date: '2026/02/28',
      total: 10,
      items: [],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const d = new Date(result.receipt.date);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(1);
    expect(d.getDate()).toBe(28);
  });

  it('folds Gemini discount lines into the matching SKU item', () => {
    const json = JSON.stringify({
      store: 'Costco',
      total: 54.99,
      items: [
        { name: '1993379 EKO MIRROR', amount: 69.99, category: 'Home' },
        { name: 'TPD/1993379', amount: -15, category: 'Other' },
      ],
    });
    const result = parseGeminiPayload(json);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.lineItems).toHaveLength(1);
    expect(result.receipt.lineItems[0].name).toMatch(/mirror/i);
    expect(result.receipt.lineItems[0].amount).toBe(54.99);
  });
});

describe('formatExamples — in-context learning from prior user corrections', () => {
  it('returns empty string when there are no examples', () => {
    expect(formatExamples([])).toBe('');
  });

  it('skips examples that have no items (no signal worth teaching)', () => {
    const out = formatExamples([{ rawOcr: 'COSTCO\nSUBTOTAL 0', items: [] }]);
    expect(out).toBe('');
  });

  it('renders an example as a numbered block with OCR + JSON items', () => {
    const out = formatExamples([
      {
        rawOcr: 'WALMART\n123 MAIN ST\nMILK 3.99\nTOTAL 3.99',
        items: [{ name: 'Milk', amount: 3.99, category: 'Groceries' }],
      },
    ]);
    expect(out).toContain('EXAMPLE 3');
    expect(out).toContain('OCR fragment:');
    expect(out).toContain('WALMART');
    expect(out).toContain('Milk');
    expect(out).toContain('3.99');
  });

  it('caps the number of examples at 3 even when more are passed', () => {
    const many = Array.from({ length: 6 }, (_, i) => ({
      rawOcr: `OCR ${i}`,
      items: [{ name: `Item ${i}`, amount: i + 1 }],
    }));
    const out = formatExamples(many);
    expect(out).toContain('EXAMPLE 3');
    expect(out).toContain('EXAMPLE 4');
    expect(out).toContain('EXAMPLE 5');
    expect(out).not.toContain('EXAMPLE 6');
  });

  it('truncates very long OCR fragments to ~1.5KB', () => {
    const longOcr = 'X'.repeat(5000);
    const out = formatExamples([
      { rawOcr: longOcr, items: [{ name: 'A', amount: 1 }] },
    ]);
    // The literal "X" run inside the prompt should be capped — there
    // shouldn't be a contiguous 2000-char X stretch in the output.
    expect(out).not.toMatch(/X{2000,}/);
  });

  it('defaults the category to "Other" when an example item omits one', () => {
    const out = formatExamples([
      { rawOcr: 'BAR\nA 1.00', items: [{ name: 'A', amount: 1 }] },
    ]);
    expect(out).toContain('"category": "Other"');
  });
});

const okEnvelope = (payload: unknown) => ({
  ok: true,
  json: async () => ({
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
        },
      },
    ],
  }),
});

describe('parseReceiptWithGemini — HTTP and prompt guards', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns no-key without fetching when the API key is missing', async () => {
    const result = await parseReceiptWithGemini('STORE\nTOTAL 5.00', '');
    expect(result).toEqual({ ok: false, kind: 'no-key', error: 'missing key or text' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns no-key without fetching when OCR text is blank', async () => {
    const result = await parseReceiptWithGemini('   ', 'gemini-key');
    expect(result).toEqual({ ok: false, kind: 'no-key', error: 'missing key or text' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns network kind when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const result = await parseReceiptWithGemini('STORE\nTOTAL 5.00', 'gemini-key');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe('network');
      expect(result.error).toContain('offline');
    }
  });

  it.each([
    [429, 'rate-limited'],
    [401, 'auth'],
    [403, 'auth'],
    [500, 'server'],
    [418, 'unknown'],
  ])('maps HTTP status %d to kind %s', async (status, kind) => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status,
      text: async () => 'error body',
    });
    const result = await parseReceiptWithGemini('STORE\nTOTAL 5.00', 'gemini-key');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe(kind);
      expect(result.error).toContain(`http ${status}`);
    }
  });

  it('returns parse kind when the envelope is not JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('Unexpected token');
      },
    });
    const result = await parseReceiptWithGemini('STORE\nTOTAL 5.00', 'gemini-key');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('parse');
  });

  it('returns empty kind when candidates have no text', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{}] } }] }),
    });
    const result = await parseReceiptWithGemini('STORE\nTOTAL 5.00', 'gemini-key');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('empty');
  });

  it('parses a 200 envelope into a receipt', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      okEnvelope({
        store: 'Walmart',
        total: 12.34,
        items: [{ name: 'Milk', amount: 12.34, category: 'Groceries' }],
      }),
    );
    const result = await parseReceiptWithGemini('WALMART\nMILK 12.34\nTOTAL 12.34', 'gemini-key');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.receipt.storeName).toBe('Walmart');
    expect(result.receipt.totalAmount).toBe(12.34);
    expect(result.receipt.lineItems[0].name).toBe('Milk');
  });

  it('disables thinking tokens and URL-encodes the API key', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      okEnvelope({ store: 'X', total: 1, items: [] }),
    );
    await parseReceiptWithGemini('X', 'key with spaces+');
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('key=key%20with%20spaces%2B');
    const body = JSON.parse(opts.body);
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 0 });
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });

  it('caps OCR at 8000 characters and splices correction examples before it', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(
      okEnvelope({ store: 'X', total: 1, items: [] }),
    );
    const ocr = `${'A'.repeat(8500)}UNIQUE_TAIL`;
    await parseReceiptWithGemini(ocr, 'k', undefined, [
      { rawOcr: 'PRIOR OCR', items: [{ name: 'Prior item', amount: 2, category: 'Groceries' }] },
    ]);
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text as string;
    expect(prompt).toContain('PRIOR OCR');
    expect(prompt).toContain('Prior item');
    expect(prompt.indexOf('PRIOR OCR')).toBeLessThan(prompt.indexOf('Receipt OCR text:'));
    expect(prompt).toContain('A'.repeat(8000));
    expect(prompt).not.toContain('UNIQUE_TAIL');
    expect(prompt).not.toContain('A'.repeat(8001));
  });
});
