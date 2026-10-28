import { classifyWithGemini, pickCategory } from '../lib/geminiClassify';

describe('pickCategory — parsing Gemini replies', () => {
  it('matches an exact category name', () => {
    expect(pickCategory('Groceries')).toBe('Groceries');
    expect(pickCategory('Electronics')).toBe('Electronics');
    expect(pickCategory('Healthcare')).toBe('Healthcare');
  });

  it('matches case-insensitively', () => {
    expect(pickCategory('groceries')).toBe('Groceries');
    expect(pickCategory('PHARMACY')).toBe('Pharmacy');
  });

  it('strips trailing punctuation, whitespace, and explanations', () => {
    expect(pickCategory('Groceries.')).toBe('Groceries');
    expect(pickCategory('  Pharmacy  ')).toBe('Pharmacy');
    expect(pickCategory('Other!')).toBe('Other');
    expect(pickCategory('The category is Groceries')).toBe('Groceries');
    expect(pickCategory('Item: → Healthcare')).toBe('Healthcare');
  });

  it('falls back to Other on unknown reply', () => {
    expect(pickCategory('Snacks')).toBe('Other');
    expect(pickCategory('I am not sure')).toBe('Other');
    expect(pickCategory('')).toBe('Other');
  });

  it('does not partial-match a longer token', () => {
    expect(pickCategory('GroceriesShop')).toBe('Other');
  });

  it('picks the FIRST recognized category if multiple appear', () => {
    expect(pickCategory('Groceries or Pharmacy')).toBe('Groceries');
  });
});

describe('classifyWithGemini', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = jest.fn() as unknown as typeof fetch;
  });

  afterAll(() => {
    global.fetch = originalFetch;
  });

  function geminiOk(text: string) {
    return {
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text }] } }],
      }),
    };
  }

  it('fails closed when the key or item name is missing', async () => {
    await expect(classifyWithGemini('Milk', '')).resolves.toEqual({
      ok: false,
      error: 'missing key or name',
    });
    await expect(classifyWithGemini('   ', 'key')).resolves.toEqual({
      ok: false,
      error: 'missing key or name',
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns a network error when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    await expect(classifyWithGemini('Milk', 'key')).resolves.toEqual({
      ok: false,
      error: 'network: offline',
    });
  });

  it('surfaces HTTP failures without treating them as Other', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'quota',
    });
    await expect(classifyWithGemini('Milk', 'key')).resolves.toEqual({
      ok: false,
      error: 'http 429: quota',
    });
  });

  it('returns a parse error for non-JSON bodies', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => {
        throw new Error('unexpected token');
      },
    });
    await expect(classifyWithGemini('Milk', 'key')).resolves.toEqual({
      ok: false,
      error: 'parse: unexpected token',
    });
  });

  it('maps the model reply through pickCategory and truncates long names in the prompt', async () => {
    (global.fetch as jest.Mock).mockResolvedValue(geminiOk('The category is Pharmacy'));
    const longName = `x${'y'.repeat(250)}`;
    await expect(classifyWithGemini(longName, 'secret-key')).resolves.toEqual({
      ok: true,
      category: 'Pharmacy',
    });

    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toContain('key=secret-key');
    const prompt = JSON.parse(opts.body).contents[0].parts[0].text as string;
    expect(prompt).toContain(longName.trim().slice(0, 200));
    expect(prompt).not.toContain(longName);
  });

  it('treats an empty Gemini payload as Other rather than failing', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ candidates: [] }),
    });
    await expect(classifyWithGemini('Mystery', 'key')).resolves.toEqual({
      ok: true,
      category: 'Other',
    });
  });
});
