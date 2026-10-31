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
  applyBudgetsSnapshot,
  getBudgetAlertsEnabled,
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

describe('household budget snapshot isolation', () => {
  it('applyBudgetsSnapshot writes only the target household', async () => {
    await setCategoryBudget('hh-a', 'Groceries', 200);
    await setBudgetAlertsEnabled('hh-a', true);
    await setCategoryBudget('hh-b', 'Groceries', 50);
    await setBudgetAlertsEnabled('hh-b', false);

    await applyBudgetsSnapshot('hh-a', {
      byCategory: { Groceries: 300, Dining: 80 },
      alertsEnabled: false,
    });

    expect(await getCategoryBudgets('hh-a')).toEqual({ Groceries: 300, Dining: 80 });
    expect(await getBudgetAlertsEnabled('hh-a')).toBe(false);
    expect(await getCategoryBudgets('hh-b')).toEqual({ Groceries: 50 });
    expect(await getBudgetAlertsEnabled('hh-b')).toBe(false);
  });

  it('corrupt category JSON reads as empty instead of throwing', async () => {
    mockedStore.set('bs.budgets.legacyMigrated', '1');
    mockedStore.set('bs.budgets.byCategory.hh-bad', '{not-json');
    expect(await getCategoryBudgets('hh-bad')).toEqual({});
  });

  it('budget alerts default off until explicitly enabled', async () => {
    mockedStore.set('bs.budgets.legacyMigrated', '1');
    expect(await getBudgetAlertsEnabled('hh-new')).toBe(false);
    await setBudgetAlertsEnabled('hh-new', true);
    expect(await getBudgetAlertsEnabled('hh-new')).toBe(true);
    await setBudgetAlertsEnabled('hh-new', false);
    expect(await getBudgetAlertsEnabled('hh-new')).toBe(false);
  });

  it('getBudgetsSnapshot composes amounts and the alerts toggle', async () => {
    await setCategoryBudget('hh-s', 'Gas', 40);
    await setBudgetAlertsEnabled('hh-s', true);
    expect(await getBudgetsSnapshot('hh-s')).toEqual({
      byCategory: { Gas: 40 },
      alertsEnabled: true,
    });
  });

  it('writing 0 keeps the category key so a later merge can clear a synced limit', async () => {
    await setCategoryBudget('hh-z', 'Travel', 120);
    await setCategoryBudget('hh-z', 'Travel', 0);
    expect(await getCategoryBudgets('hh-z')).toEqual({ Travel: 0 });
  });
});
