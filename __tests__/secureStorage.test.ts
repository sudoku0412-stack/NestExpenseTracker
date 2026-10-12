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
  getCloudMigrationDone,
  setCloudMigrationDone,
} from '../lib/secureStorage';

const mockedStore = (SecureStore as unknown as { __store: Map<string, string> }).__store;

beforeEach(() => {
  mockedStore.clear();
  jest.clearAllMocks();
  jest.useRealTimers();
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

  it('does not count last month against this month (free-tier quota rollover)', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-15T12:00:00'));
    expect(await incrementAiParseCount('uid-1')).toBe(1);
    expect(await incrementAiParseCount('uid-1')).toBe(2);
    expect(mockedStore.get('bs.aiParse.count.uid-1.2026-01')).toBe('2');

    jest.setSystemTime(new Date('2026-02-01T12:00:00'));
    expect(await getAiParseCountThisMonth('uid-1')).toBe(0);
    expect(await incrementAiParseCount('uid-1')).toBe(1);
    expect(mockedStore.get('bs.aiParse.count.uid-1.2026-01')).toBe('2');
    expect(mockedStore.get('bs.aiParse.count.uid-1.2026-02')).toBe('1');
    jest.useRealTimers();
  });

  it('treats a corrupt stored count as 0', async () => {
    mockedStore.set(`bs.aiParse.count.uid-1.${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`, 'nope');
    expect(await getAiParseCountThisMonth('uid-1')).toBe(0);
  });
});

describe('cloud migration marker', () => {
  it('is per uid so a second account on the same device still migrates', async () => {
    expect(await getCloudMigrationDone('u1')).toBe(false);
    await setCloudMigrationDone('u1');
    expect(await getCloudMigrationDone('u1')).toBe(true);
    expect(await getCloudMigrationDone('u2')).toBe(false);
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
