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
  getLanguagePreference,
  setLanguagePreference,
  getThemePreference,
  setThemePreference,
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

describe('language and theme preference fallbacks', () => {
  it('treats a missing or unknown language as system', async () => {
    expect(await getLanguagePreference()).toBe('system');
    mockedStore.set('bs.language.preference', 'de');
    expect(await getLanguagePreference()).toBe('system');
    await setLanguagePreference('fr');
    expect(await getLanguagePreference()).toBe('fr');
    await setLanguagePreference('en');
    expect(await getLanguagePreference()).toBe('en');
    await setLanguagePreference('system');
    expect(await getLanguagePreference()).toBe('system');
  });

  it('treats a missing or unknown theme as system', async () => {
    expect(await getThemePreference()).toBe('system');
    mockedStore.set('bs.theme.preference', 'sepia');
    expect(await getThemePreference()).toBe('system');
    await setThemePreference('dark');
    expect(await getThemePreference()).toBe('dark');
    await setThemePreference('light');
    expect(await getThemePreference()).toBe('light');
  });
});

describe('AI parse quota resilience', () => {
  it('treats a non-numeric stored count as 0 so a corrupt value cannot skip the free-tier gate', async () => {
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    mockedStore.set(`bs.aiParse.count.uid-1.${ym}`, 'not-a-number');
    expect(await getAiParseCountThisMonth('uid-1')).toBe(0);
    expect(await incrementAiParseCount('uid-1')).toBe(1);
  });
});
