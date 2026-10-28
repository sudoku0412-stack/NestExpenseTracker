const mockGetCachedItemClassification = jest.fn();
const mockSetCachedItemClassification = jest.fn();
const mockUpdateLineItemCategory = jest.fn();
const mockGetAiClassifyEnabled = jest.fn();
const mockGetAnthropicApiKey = jest.fn();
const mockClassifyWithAnthropic = jest.fn();
const mockClassifyWithGemini = jest.fn();

let mockGeminiKey: string | undefined;

jest.mock('../lib/database', () => ({
  getCachedItemClassification: (...args: unknown[]) => mockGetCachedItemClassification(...args),
  setCachedItemClassification: (...args: unknown[]) => mockSetCachedItemClassification(...args),
  updateLineItemCategory: (...args: unknown[]) => mockUpdateLineItemCategory(...args),
}));

jest.mock('../lib/secureStorage', () => ({
  getAiClassifyEnabled: (...args: unknown[]) => mockGetAiClassifyEnabled(...args),
  getAnthropicApiKey: (...args: unknown[]) => mockGetAnthropicApiKey(...args),
}));

jest.mock('../lib/anthropicClassify', () => ({
  classifyWithAnthropic: (...args: unknown[]) => mockClassifyWithAnthropic(...args),
}));

jest.mock('../lib/geminiClassify', () => ({
  classifyWithGemini: (...args: unknown[]) => mockClassifyWithGemini(...args),
}));

jest.mock('expo-constants', () => ({
  get expoConfig() {
    return { extra: { geminiApiKey: mockGeminiKey } };
  },
}));

import { classifyItemAsync, refineUncategorizedItems } from '../lib/itemClassifier';
import { LineItem } from '../types';

const originalFetch = global.fetch;

beforeEach(() => {
  jest.clearAllMocks();
  mockGeminiKey = undefined;
  mockGetCachedItemClassification.mockResolvedValue(null);
  mockGetAiClassifyEnabled.mockResolvedValue(false);
  mockGetAnthropicApiKey.mockResolvedValue(null);
  global.fetch = jest.fn() as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

describe('classifyItemAsync', () => {
  it('returns immediately on a cache hit without touching local/remote layers', async () => {
    mockGetCachedItemClassification.mockResolvedValue({ category: 'Electronics', source: 'remote' });
    const result = await classifyItemAsync('Milk');
    expect(result).toBe('Electronics');
    expect(mockClassifyWithGemini).not.toHaveBeenCalled();
    expect(mockClassifyWithAnthropic).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('local keyword match short-circuits and caches as local', async () => {
    const result = await classifyItemAsync('Milk');
    expect(result).toBe('Groceries');
    expect(mockSetCachedItemClassification).toHaveBeenCalledWith('milk', 'Groceries', 'local');
    expect(mockClassifyWithGemini).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('calls classifyWithGemini and caches as remote when a Gemini key is configured and local is Other', async () => {
    mockGeminiKey = 'gemini-key';
    mockClassifyWithGemini.mockResolvedValue({ ok: true, category: 'Electronics' });
    const result = await classifyItemAsync('SomeMysteryItemXYZ');
    expect(result).toBe('Electronics');
    expect(mockClassifyWithGemini).toHaveBeenCalledWith('somemysteryitemxyz', 'gemini-key');
    expect(mockSetCachedItemClassification).toHaveBeenCalledWith('somemysteryitemxyz', 'Electronics', 'remote');
  });

  it('falls through to Anthropic when Gemini fails and AI-classify is enabled with a stored key', async () => {
    mockGeminiKey = 'gemini-key';
    mockClassifyWithGemini.mockRejectedValue(new Error('quota exceeded'));
    mockGetAiClassifyEnabled.mockResolvedValue(true);
    mockGetAnthropicApiKey.mockResolvedValue('anthropic-key');
    mockClassifyWithAnthropic.mockResolvedValue({ ok: true, category: 'Pharmacy' });
    const result = await classifyItemAsync('SomeMysteryItemXYZ');
    expect(result).toBe('Pharmacy');
    expect(mockClassifyWithAnthropic).toHaveBeenCalledWith('somemysteryitemxyz', 'anthropic-key');
    expect(mockSetCachedItemClassification).toHaveBeenCalledWith('somemysteryitemxyz', 'Pharmacy', 'remote');
  });

  it('falls through to Anthropic when there is no Gemini key at all', async () => {
    mockGetAiClassifyEnabled.mockResolvedValue(true);
    mockGetAnthropicApiKey.mockResolvedValue('anthropic-key');
    mockClassifyWithAnthropic.mockResolvedValue({ ok: true, category: 'Dining' });
    const result = await classifyItemAsync('SomeMysteryItemXYZ');
    expect(result).toBe('Dining');
    expect(mockClassifyWithGemini).not.toHaveBeenCalled();
  });

  it('falls through to the backend endpoint when neither AI path applies', async () => {
    process.env.EXPO_PUBLIC_CLASSIFY_ENDPOINT = 'https://classify.example';
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({ category: 'Travel' }),
    });
    const result = await classifyItemAsync('SomeMysteryItemXYZ');
    expect(result).toBe('Travel');
    expect(global.fetch).toHaveBeenCalledWith(
      'https://classify.example',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(mockSetCachedItemClassification).toHaveBeenCalledWith('somemysteryitemxyz', 'Travel', 'remote');
    delete process.env.EXPO_PUBLIC_CLASSIFY_ENDPOINT;
  });

  it('returns Other with no network call when nothing is configured', async () => {
    const result = await classifyItemAsync('SomeMysteryItemXYZ');
    expect(result).toBe('Other');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(mockClassifyWithGemini).not.toHaveBeenCalled();
    expect(mockClassifyWithAnthropic).not.toHaveBeenCalled();
  });

  it('returns Other for an empty/whitespace-only cleaned name without any network calls', async () => {
    const result = await classifyItemAsync('   ');
    expect(result).toBe('Other');
    expect(mockGetCachedItemClassification).not.toHaveBeenCalled();
  });

  it('ignores an invalid cached category and falls through to local classification', async () => {
    mockGetCachedItemClassification.mockResolvedValue({ category: 'NotARealCategory', source: 'local' });
    const result = await classifyItemAsync('Milk');
    expect(result).toBe('Groceries');
  });

  it('does not cache an invalid Gemini category and falls through to Anthropic', async () => {
    mockGeminiKey = 'gemini-key';
    mockClassifyWithGemini.mockResolvedValue({ ok: true, category: 'Snacks' });
    mockGetAiClassifyEnabled.mockResolvedValue(true);
    mockGetAnthropicApiKey.mockResolvedValue('anthropic-key');
    mockClassifyWithAnthropic.mockResolvedValue({ ok: true, category: 'Pharmacy' });
    const result = await classifyItemAsync('SomeMysteryItemXYZ');
    expect(result).toBe('Pharmacy');
    expect(mockSetCachedItemClassification).toHaveBeenCalledTimes(1);
    expect(mockSetCachedItemClassification).toHaveBeenCalledWith('somemysteryitemxyz', 'Pharmacy', 'remote');
  });

  it('ignores an unknown or failed backend category instead of caching it', async () => {
    process.env.EXPO_PUBLIC_CLASSIFY_ENDPOINT = 'https://classify.example';
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ category: 'Snacks' }),
    });
    await expect(classifyItemAsync('SomeMysteryItemXYZ')).resolves.toBe('Other');
    expect(mockSetCachedItemClassification).not.toHaveBeenCalled();

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      json: async () => ({ category: 'Travel' }),
    });
    await expect(classifyItemAsync('SomeMysteryItemXYZ')).resolves.toBe('Other');
    expect(mockSetCachedItemClassification).not.toHaveBeenCalled();
    delete process.env.EXPO_PUBLIC_CLASSIFY_ENDPOINT;
  });
});

describe('refineUncategorizedItems', () => {
  const item = (overrides: Partial<LineItem>): LineItem => ({
    id: 'i1',
    name: 'Item',
    amount: 1,
    ...overrides,
  });

  it('skips items already categorized as non-Other', async () => {
    const items = [item({ category: 'Groceries' })];
    const result = await refineUncategorizedItems(items);
    expect(result).toEqual(items);
    expect(mockUpdateLineItemCategory).not.toHaveBeenCalled();
  });

  it('reclassifies and persists an item that was Other/uncategorized', async () => {
    const items = [item({ id: 'i2', name: 'Milk', category: 'Other' })];
    const result = await refineUncategorizedItems(items);
    expect(result[0].category).toBe('Groceries');
    expect(mockUpdateLineItemCategory).toHaveBeenCalledWith('i2', 'Groceries');
  });

  it('leaves an item unchanged (no persist call) if reclassification still lands on the same category', async () => {
    const items = [item({ id: 'i3', name: 'UnknownThing', category: 'Other' })];
    const result = await refineUncategorizedItems(items);
    expect(result[0].category).toBe('Other');
    expect(mockUpdateLineItemCategory).not.toHaveBeenCalled();
  });

  it('treats an undefined category the same as Other', async () => {
    const items = [item({ id: 'i4', name: 'Milk', category: undefined })];
    const result = await refineUncategorizedItems(items);
    expect(result[0].category).toBe('Groceries');
    expect(mockUpdateLineItemCategory).toHaveBeenCalledWith('i4', 'Groceries');
  });
});
