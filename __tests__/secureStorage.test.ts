jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

import * as SecureStore from 'expo-secure-store';
import {
  getOnboardingSeen,
  setOnboardingSeen,
  getAiParseCountThisMonth,
  incrementAiParseCount,
  getAnthropicApiKey,
  setAnthropicApiKey,
  getGeminiApiKey,
  setGeminiApiKey,
} from '../lib/secureStorage';

const mockedStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  mockedStore.clear();
  jest.clearAllMocks();
});

describe('onboarding flag', () => {
  it('returns false when never set', async () => {
    expect(await getOnboardingSeen()).toBe(false);
  });

  it('returns true after marking seen', async () => {
    await setOnboardingSeen();
    expect(await getOnboardingSeen()).toBe(true);
  });

  it('persists under a stable key (do not rename without a migration)', async () => {
    await setOnboardingSeen();
    expect(mockedStore.get('bs.onboarding.seen')).toBe('1');
  });
});

describe('AI parse quota', () => {
  it('starts at 0 for a user who has never parsed', async () => {
    expect(await getAiParseCountThisMonth('uid-1')).toBe(0);
  });

  it('increments and persists per call', async () => {
    expect(await incrementAiParseCount('uid-1')).toBe(1);
    expect(await incrementAiParseCount('uid-1')).toBe(2);
    expect(await getAiParseCountThisMonth('uid-1')).toBe(2);
  });

  it('tracks each uid independently', async () => {
    await incrementAiParseCount('uid-1');
    await incrementAiParseCount('uid-1');
    await incrementAiParseCount('uid-2');
    expect(await getAiParseCountThisMonth('uid-1')).toBe(2);
    expect(await getAiParseCountThisMonth('uid-2')).toBe(1);
  });
});

describe('storage key namespace', () => {
  it('all keys share the bs. prefix to avoid collisions', async () => {
    await setOnboardingSeen();
    for (const key of mockedStore.keys()) {
      expect(key.startsWith('bs.')).toBe(true);
    }
  });
});

describe('AI API keys', () => {
  it('trims stored Gemini/Anthropic keys and deletes them when blank', async () => {
    await setGeminiApiKey('  gem-live  ');
    await setAnthropicApiKey('\nsk-ant-live\n');
    expect(await getGeminiApiKey()).toBe('gem-live');
    expect(await getAnthropicApiKey()).toBe('sk-ant-live');
    expect(mockedStore.get('bs.gemini.apiKey')).toBe('gem-live');
    expect(mockedStore.get('bs.anthropic.apiKey')).toBe('sk-ant-live');

    await setGeminiApiKey('   ');
    await setAnthropicApiKey(null);
    expect(await getGeminiApiKey()).toBeNull();
    expect(await getAnthropicApiKey()).toBeNull();
    expect(mockedStore.has('bs.gemini.apiKey')).toBe(false);
    expect(mockedStore.has('bs.anthropic.apiKey')).toBe(false);
  });
});
