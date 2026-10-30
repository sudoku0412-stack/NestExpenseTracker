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
  getLastBudgetAlertDate,
  setLastBudgetAlertDate,
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

describe('lastBudgetAlertDate household isolation', () => {
  it('stores today\'s throttle independently per household', async () => {
    await setLastBudgetAlertDate('hh-a', '2026-10-30');
    await setLastBudgetAlertDate('hh-b', '2026-10-29');
    expect(await getLastBudgetAlertDate('hh-a')).toBe('2026-10-30');
    expect(await getLastBudgetAlertDate('hh-b')).toBe('2026-10-29');
    expect(mockedStore.get('bs.budgets.lastAlertDate.hh-a')).toBe('2026-10-30');
    expect(mockedStore.get('bs.budgets.lastAlertDate.hh-b')).toBe('2026-10-29');
  });

  it('returns null when that household has never alerted', async () => {
    expect(await getLastBudgetAlertDate('never')).toBeNull();
  });
});
