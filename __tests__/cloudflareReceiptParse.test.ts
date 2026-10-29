import { parseReceiptWithCloudflare } from '../lib/cloudflareReceiptParse';

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('parseReceiptWithCloudflare', () => {
  it('returns no-key when endpoint is empty', async () => {
    const result = await parseReceiptWithCloudflare({ rawText: 'STORE\nTOTAL 5.00', endpoint: '' });
    expect(result).toEqual({ ok: false, kind: 'no-key', error: 'no worker endpoint configured' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns no-key when rawText is empty/whitespace', async () => {
    const result = await parseReceiptWithCloudflare({ rawText: '   ', endpoint: 'https://worker.example' });
    expect(result).toEqual({ ok: false, kind: 'no-key', error: 'empty OCR text' });
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('returns network kind when fetch throws', async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error('offline'));
    const result = await parseReceiptWithCloudflare({
      rawText: 'STORE\nTOTAL 5.00',
      endpoint: 'https://worker.example',
    });
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
    const result = await parseReceiptWithCloudflare({
      rawText: 'STORE\nTOTAL 5.00',
      endpoint: 'https://worker.example',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.kind).toBe(kind);
    }
  });

  it('delegates a valid 200 response to parseGeminiPayload', async () => {
    const payload = JSON.stringify({
      store: 'Walmart',
      total: 12.34,
      items: [{ name: 'Milk', amount: 12.34, category: 'Groceries' }],
    });
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => payload,
    });
    const result = await parseReceiptWithCloudflare({
      rawText: 'WALMART\nMILK 12.34\nTOTAL 12.34',
      endpoint: 'https://worker.example',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.receipt.storeName).toBe('Walmart');
      expect(result.receipt.totalAmount).toBe(12.34);
      expect(result.receipt.lineItems[0].name).toBe('Milk');
    }
  });

  it('sends the app secret header when provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ store: 'X', total: 1, items: [] }),
    });
    await parseReceiptWithCloudflare({
      rawText: 'X',
      endpoint: 'https://worker.example',
      appSecret: 'secret123',
    });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(opts.headers['x-app-secret']).toBe('secret123');
  });

  it('omits the app secret header when not provided', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ store: 'X', total: 1, items: [] }),
    });
    await parseReceiptWithCloudflare({ rawText: 'X', endpoint: 'https://worker.example' });
    const [, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(opts.headers['x-app-secret']).toBeUndefined();
  });

  it('posts correction examples so the worker can few-shot the same store', async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ store: 'X', total: 1, items: [] }),
    });
    const examples = [{ rawOcr: 'COSTCO MILK', items: [{ name: 'Milk', amount: 3.99, category: 'Groceries' }] }];
    await parseReceiptWithCloudflare({
      rawText: 'COSTCO\nMILK 3.99',
      endpoint: 'https://worker.example/parse',
      examples,
    });
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe('https://worker.example/parse');
    expect(JSON.parse(opts.body)).toEqual({
      rawText: 'COSTCO\nMILK 3.99',
      examples,
    });
  });
});
