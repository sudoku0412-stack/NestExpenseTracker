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
  getAiClassifyEnabled,
  setAiClassifyEnabled,
  getWhatsNewSeenVersion,
  setWhatsNewSeenVersion,
  getCurrency,
  setCurrency,
  resetAllSecureStorage,
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

describe('AI classify toggle', () => {
  it('defaults off and deletes the key when turned off', async () => {
    expect(await getAiClassifyEnabled()).toBe(false);
    await setAiClassifyEnabled(true);
    expect(await getAiClassifyEnabled()).toBe(true);
    expect(mockedStore.get('bs.aiClassify.enabled')).toBe('1');
    await setAiClassifyEnabled(false);
    expect(await getAiClassifyEnabled()).toBe(false);
    expect(mockedStore.has('bs.aiClassify.enabled')).toBe(false);
  });
});

describe('what\'s-new seen version', () => {
  it('round-trips the last seen app version', async () => {
    expect(await getWhatsNewSeenVersion()).toBeNull();
    await setWhatsNewSeenVersion('2.0.0');
    expect(await getWhatsNewSeenVersion()).toBe('2.0.0');
    expect(mockedStore.get('bs.whatsNew.seenVersion')).toBe('2.0.0');
  });
});

describe('display currency', () => {
  it('round-trips the chosen code', async () => {
    expect(await getCurrency()).toBeNull();
    await setCurrency('CAD');
    expect(await getCurrency()).toBe('CAD');
    expect(mockedStore.get('bs.currency')).toBe('CAD');
  });
});

describe('resetAllSecureStorage', () => {
  it('deletes the top-level keys (onboarding, AI classify, what\'s-new, currency)', async () => {
    await setOnboardingSeen();
    await setAiClassifyEnabled(true);
    await setWhatsNewSeenVersion('2.0.0');
    await setCurrency('EUR');
    await incrementAiParseCount('uid-1');

    await resetAllSecureStorage();

    expect(await getOnboardingSeen()).toBe(false);
    expect(await getAiClassifyEnabled()).toBe(false);
    expect(await getWhatsNewSeenVersion()).toBeNull();
    expect(await getCurrency()).toBeNull();
    // Namespaced quota keys are not in the Keys map — they survive a
    // top-level reset. Pin that so a later wipe change is deliberate.
    expect(await getAiParseCountThisMonth('uid-1')).toBe(1);
  });
});
