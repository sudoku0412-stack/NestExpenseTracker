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
  applyBudgetsSnapshot,
  clearBudgetsForHousehold,
  getBudgetsSnapshot,
  getCategoryBudgets,
  setBudgetAlertsEnabled,
  setCategoryBudget,
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

describe('household budgets snapshot', () => {
  beforeEach(async () => {
    mockedStore.set('bs.budgets.legacyMigrated', '1');
  });

  it('treats corrupt JSON as an empty budget map', async () => {
    mockedStore.set('bs.budgets.byCategory.hh1', '{not-json');
    await expect(getCategoryBudgets('hh1')).resolves.toEqual({});
  });

  it('getBudgetsSnapshot composes amounts and the alerts toggle', async () => {
    await setCategoryBudget('hh1', 'Groceries', 200);
    await setBudgetAlertsEnabled('hh1', true);
    await expect(getBudgetsSnapshot('hh1')).resolves.toEqual({
      byCategory: { Groceries: 200 },
      alertsEnabled: true,
    });
  });

  it('applyBudgetsSnapshot merges remote amounts and does not drop local categories omitted from the snapshot', async () => {
    await setCategoryBudget('hh1', 'Groceries', 100);
    await setCategoryBudget('hh1', 'Dining', 50);
    await applyBudgetsSnapshot('hh1', {
      byCategory: { Groceries: 250 },
      alertsEnabled: true,
    });
    await expect(getBudgetsSnapshot('hh1')).resolves.toEqual({
      byCategory: { Groceries: 250, Dining: 50 },
      alertsEnabled: true,
    });
  });

  it('clearBudgetsForHousehold only wipes that household', async () => {
    await setCategoryBudget('hh1', 'Groceries', 100);
    await setCategoryBudget('hh2', 'Groceries', 999);
    await setBudgetAlertsEnabled('hh2', true);
    mockedStore.set('bs.customCategories.hh1', '[{"name":"Pets","color":"#111"}]');
    mockedStore.set('bs.customCategories.hh2', '[{"name":"Keep","color":"#222"}]');

    await clearBudgetsForHousehold('hh1');

    await expect(getCategoryBudgets('hh1')).resolves.toEqual({});
    await expect(getCategoryBudgets('hh2')).resolves.toEqual({ Groceries: 999 });
    expect(mockedStore.get('bs.customCategories.hh1')).toBeUndefined();
    expect(mockedStore.get('bs.customCategories.hh2')).toBe('[{"name":"Keep","color":"#222"}]');
  });
});
