import { classifyWithAnthropic, pickCategory } from '../lib/anthropicClassify';

describe('pickCategory — parsing Anthropic replies', () => {
  it('matches an exact category name', () => {
    expect(pickCategory('Groceries')).toBe('Groceries');
    expect(pickCategory('Electronics')).toBe('Electronics');
    expect(pickCategory('Healthcare')).toBe('Healthcare');
  });

  it('matches case-insensitively', () => {
    expect(pickCategory('groceries')).toBe('Groceries');
    expect(pickCategory('PHARMACY')).toBe('Pharmacy');
  });

  it('strips trailing punctuation and whitespace', () => {
    expect(pickCategory('Groceries.')).toBe('Groceries');
    expect(pickCategory('  Pharmacy  ')).toBe('Pharmacy');
    expect(pickCategory('Other!')).toBe('Other');
  });

  it('extracts category from a verbose reply', () => {
    expect(pickCategory('The category is Groceries')).toBe('Groceries');
    expect(pickCategory('Item: → Healthcare')).toBe('Healthcare');
  });

  it('falls back to Other on unknown reply', () => {
    expect(pickCategory('Snacks')).toBe('Other');
    expect(pickCategory('I am not sure')).toBe('Other');
    expect(pickCategory('')).toBe('Other');
  });

  it('does not partial-match (e.g. "GroceriesShop" should not match Groceries)', () => {
    // Word-boundary regex means a contiguous longer token like
    // "GroceriesAndMore" without spaces won't match. With our regex
    // ([^A-Za-z]+ collapsed to spaces) it WILL still match because the
    // sequence becomes 'GroceriesAndMore' as a single token; \b sits
    // between the e and A only if A is non-word, but A is a letter.
    expect(pickCategory('GroceriesShop')).toBe('Other');
  });

  it('picks the FIRST recognized category if multiple appear', () => {
    expect(pickCategory('Groceries or Pharmacy')).toBe('Groceries');
  });
});

describe('classifyWithAnthropic — HTTP and prompt guards', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  it('returns missing key/name without fetching', async () => {
    await expect(classifyWithAnthropic('Milk', '')).resolves.toEqual({
      ok: false,
      error: 'missing key or name',
    });
    await expect(classifyWithAnthropic('   ', 'sk-ant')).resolves.toEqual({
      ok: false,
      error: 'missing key or name',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns a network error when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const result = await classifyWithAnthropic('Mystery item', 'sk-ant');
    expect(result).toEqual({ ok: false, error: 'network: offline' });
  });

  it('surfaces HTTP status and a truncated body', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'x'.repeat(400),
    });
    const result = await classifyWithAnthropic('Mystery item', 'sk-ant');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/^http 429: x{200}$/);
    }
  });

  it('returns parse error when the body is not JSON', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('bad json');
      },
    });
    const result = await classifyWithAnthropic('Mystery item', 'sk-ant');
    expect(result).toEqual({ ok: false, error: 'parse: bad json' });
  });

  it('maps an empty reply to Other (ok:true) so callers can cache a fallback', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [] }),
    });
    await expect(classifyWithAnthropic('Mystery item', 'sk-ant')).resolves.toEqual({
      ok: true,
      category: 'Other',
    });
  });

  it('sends the user key, caps the item name at 200 chars, and parses a category', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ content: [{ type: 'text', text: 'Electronics' }] }),
    });
    const longName = `gadget-${'z'.repeat(250)}`;
    const result = await classifyWithAnthropic(longName, 'sk-secret');
    expect(result).toEqual({ ok: true, category: 'Electronics' });

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(opts.headers['x-api-key']).toBe('sk-secret');
    expect(opts.headers['anthropic-version']).toBe('2023-06-01');
    const body = JSON.parse(opts.body);
    expect(body.model).toBe('claude-haiku-4-5-20251001');
    expect(body.max_tokens).toBe(16);
    const prompt = body.messages[0].content as string;
    expect(prompt).toContain(`Item: "${longName.trim().slice(0, 200)}" →`);
    expect(prompt).not.toContain('z'.repeat(201));
  });
});
