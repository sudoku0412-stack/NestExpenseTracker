/**
 * When the active household is unset, savings-goal list/delete stay
 * uid-scoped: other users never leak in, but this user's envelopes in
 * any household (including NULL-hid backfill) remain visible/deletable.
 * Cloud delete still requires a matching household id.
 */

type GoalRow = {
  id: string;
  name: string;
  target_usd: number;
  allocated_usd: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
  household_id: string | null;
};

const mockRows = new Map<string, GoalRow>();

function mockHidMode(sql: string): 'none' | 'loose' | 'strict' {
  if (/household_id IS NULL/i.test(sql)) return 'loose';
  if (/household_id\s*=\s*\?/i.test(sql)) return 'strict';
  return 'none';
}

function mockMatchesHid(row: GoalRow, sql: string, params: unknown[]): boolean {
  const mode = mockHidMode(sql);
  if (mode === 'none') return true;
  const hid = params[params.length - 1] as string | null | undefined;
  if (mode === 'strict') return row.household_id === hid;
  return row.household_id === null || row.household_id === hid;
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM savings_goals')) return null;
      const id = params[0] as string;
      const row = mockRows.get(id);
      if (!row) return null;
      if (sql.includes('user_id') && row.user_id !== params[1]) return null;
      return mockMatchesHid(row, sql, params) ? row : null;
    }),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM savings_goals')) return [];
      const uid = params[0] as string;
      return [...mockRows.values()]
        .filter((r) => r.user_id === uid && mockMatchesHid(r, sql, params))
        .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/DELETE FROM savings_goals/i.test(sql)) {
        const id = params[0] as string;
        const uid = params[1] as string;
        const row = mockRows.get(id);
        if (row && row.user_id === uid && mockMatchesHid(row, sql, params)) {
          mockRows.delete(id);
          return { lastInsertRowId: 0, changes: 1 };
        }
        return { lastInsertRowId: 0, changes: 0 };
      }
      return { lastInsertRowId: 0, changes: 0 };
    }),
  }),
}));

jest.mock('../../lib/cloudSync', () => ({
  syncReceiptDeletionToCloud: jest.fn(),
  syncReceiptToCloud: jest.fn(),
  syncSettlementToCloud: jest.fn(),
  syncIncomeToCloud: jest.fn(),
  syncIncomeDeletionToCloud: jest.fn(),
  syncSavingsGoalToCloud: jest.fn(),
  syncSavingsGoalDeletionToCloud: jest.fn(),
  syncInvestmentAccountToCloud: jest.fn(),
  syncInvestmentAccountDeletionToCloud: jest.fn(),
  syncInvestmentSnapshotToCloud: jest.fn(),
  uploadReceiptPhoto: jest.fn(),
}));

import {
  deleteSavingsGoal,
  deleteSavingsGoalFromCloud,
  getAllSavingsGoals,
  setCurrentHouseholdId,
  setCurrentUserId,
} from '../../lib/database';
import { syncSavingsGoalDeletionToCloud } from '../../lib/cloudSync';

const mockSyncDelete = syncSavingsGoalDeletionToCloud as jest.Mock;

function seed(overrides: Partial<GoalRow>): GoalRow {
  const row: GoalRow = {
    id: 'g1',
    name: 'Emergency',
    target_usd: 1000,
    allocated_usd: 100,
    notes: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    user_id: 'user-1',
    household_id: 'hh1',
    ...overrides,
  };
  mockRows.set(row.id, row);
  return row;
}

beforeEach(async () => {
  mockRows.clear();
  mockSyncDelete.mockClear();
  setCurrentHouseholdId(null);
  await setCurrentUserId('user-1');
});

describe('getAllSavingsGoals with household unset', () => {
  it('hides other uids and includes this user\'s other-household + NULL-hid envelopes', async () => {
    seed({ id: 'mine-hh1', household_id: 'hh1', created_at: 'a' });
    seed({ id: 'mine-other', household_id: 'hh-other', created_at: 'b' });
    seed({ id: 'mine-null', household_id: null, created_at: 'c' });
    seed({ id: 'theirs', user_id: 'user-2', household_id: null, created_at: 'd' });

    const rows = await getAllSavingsGoals();
    expect(rows.map((g) => g.id)).toEqual(['mine-hh1', 'mine-other', 'mine-null']);
  });

  it('unsigned list throws and reads nothing', async () => {
    seed({ id: 'mine-hh1' });
    await setCurrentUserId(null);
    await expect(getAllSavingsGoals()).rejects.toThrow(/No authenticated user/);
  });
});

describe('deleteSavingsGoal with household unset', () => {
  it('is uid-scoped: can delete this user\'s other-household row, never another uid', async () => {
    seed({ id: 'mine-other', household_id: 'hh-other' });
    seed({ id: 'theirs', user_id: 'user-2', household_id: null });

    await deleteSavingsGoal('theirs');
    expect(mockRows.has('theirs')).toBe(true);

    await deleteSavingsGoal('mine-other');
    expect(mockRows.has('mine-other')).toBe(false);
    expect(mockSyncDelete).not.toHaveBeenCalled();
  });

  it('unsigned delete throws and writes nothing', async () => {
    seed({ id: 'g1' });
    await setCurrentUserId(null);
    await expect(deleteSavingsGoal('g1')).rejects.toThrow(/No authenticated user/);
    expect(mockRows.has('g1')).toBe(true);
  });
});

describe('deleteSavingsGoalFromCloud', () => {
  it('does not drop a NULL-household leftover even when the id matches', async () => {
    seed({ id: 'g1', household_id: null });
    await deleteSavingsGoalFromCloud('g1', 'user-1', 'hh1');
    expect(mockRows.has('g1')).toBe(true);
  });
});
