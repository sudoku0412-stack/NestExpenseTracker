/**
 * A stale Firestore snapshot must not overwrite a newer local envelope.
 * Local save/delete must stamp uid+hid, stay household-scoped, and skip
 * the cloud shadow-write when there is no active household.
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

function mockRowFromInsertParams(params: unknown[]): GoalRow {
  return {
    id: params[0] as string,
    name: params[1] as string,
    target_usd: params[2] as number,
    allocated_usd: params[3] as number,
    notes: (params[4] as string | null) ?? null,
    created_at: params[5] as string,
    updated_at: params[6] as string,
    user_id: params[7] as string,
    household_id: (params[8] as string | null) ?? null,
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM savings_goals')) return [];
      const uid = params[0] as string;
      return [...mockRows.values()].filter(
        (r) => r.user_id === uid && mockMatchesHid(r, sql, params),
      );
    }),
    getFirstAsync: jest.fn(async (_sql: string, params: string[]) => mockRows.get(params[0]) ?? null),
    runAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (/DELETE FROM savings_goals/i.test(sql)) {
        const id = params[0] as string;
        const uid = params[1] as string;
        const row = mockRows.get(id);
        if (row && row.user_id === uid && mockMatchesHid(row, sql, params)) {
          mockRows.delete(id);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/INSERT OR REPLACE INTO savings_goals/i.test(sql) || /INSERT INTO savings_goals/i.test(sql)) {
        const row = mockRowFromInsertParams(params);
        mockRows.set(row.id, row);
        return { lastInsertRowId: 0, changes: 1 };
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
  uploadReceiptPhoto: jest.fn(),
}));

import {
  deleteSavingsGoal,
  deleteSavingsGoalFromCloud,
  getAllSavingsGoals,
  saveSavingsGoal,
  setCurrentHouseholdId,
  setCurrentUserId,
  upsertSavingsGoalFromCloud,
} from '../../lib/database';
import { syncSavingsGoalDeletionToCloud, syncSavingsGoalToCloud } from '../../lib/cloudSync';
import { SavingsGoal } from '../../types';

const mockSyncSavingsGoalToCloud = syncSavingsGoalToCloud as jest.Mock;
const mockSyncSavingsGoalDeletionToCloud = syncSavingsGoalDeletionToCloud as jest.Mock;

function goal(overrides: Partial<SavingsGoal> = {}): SavingsGoal {
  return {
    id: 'g1',
    name: 'Emergency',
    targetUsd: 1000,
    allocatedUsd: 100,
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(async () => {
  mockRows.clear();
  mockSyncSavingsGoalToCloud.mockClear();
  mockSyncSavingsGoalDeletionToCloud.mockClear();
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('user-1');
});

describe('upsertSavingsGoalFromCloud', () => {
  it('keeps a newer local envelope when the cloud snapshot is older', async () => {
    mockRows.set('g1', {
      id: 'g1',
      name: 'Vacation',
      target_usd: 2000,
      allocated_usd: 500,
      notes: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-02T12:00:00.000Z',
      user_id: 'user-1',
      household_id: 'hh1',
    });

    await upsertSavingsGoalFromCloud(
      goal({
        name: 'Old name',
        targetUsd: 1000,
        allocatedUsd: 50,
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('g1')).toMatchObject({
      name: 'Vacation',
      allocated_usd: 500,
      updated_at: '2026-03-02T12:00:00.000Z',
    });
  });

  it('applies a cloud snapshot that is newer than the local row', async () => {
    mockRows.set('g1', {
      id: 'g1',
      name: 'Old',
      target_usd: 1000,
      allocated_usd: 10,
      notes: null,
      created_at: '2026-03-01T00:00:00.000Z',
      updated_at: '2026-03-01T00:00:00.000Z',
      user_id: 'user-1',
      household_id: 'hh1',
    });

    await upsertSavingsGoalFromCloud(
      goal({
        name: 'Emergency',
        allocatedUsd: 400,
        updatedAt: '2026-03-03T00:00:00.000Z',
      }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('g1')).toMatchObject({
      name: 'Emergency',
      allocated_usd: 400,
      updated_at: '2026-03-03T00:00:00.000Z',
      user_id: 'user-1',
      household_id: 'house-1',
    });
  });
});

describe('saveSavingsGoal / deleteSavingsGoal isolation', () => {
  it('stamps uid+hid and shadow-writes only when a household is active', async () => {
    await saveSavingsGoal(goal({ id: 'g-new', name: 'Car' }));
    expect(mockRows.get('g-new')).toMatchObject({
      name: 'Car',
      user_id: 'user-1',
      household_id: 'hh1',
    });
    expect(mockSyncSavingsGoalToCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'g-new', name: 'Car' }),
      'hh1',
    );

    mockSyncSavingsGoalToCloud.mockClear();
    setCurrentHouseholdId(null);
    await saveSavingsGoal(goal({ id: 'g-local', name: 'Solo' }));
    expect(mockRows.get('g-local')).toMatchObject({
      household_id: null,
      user_id: 'user-1',
    });
    expect(mockSyncSavingsGoalToCloud).not.toHaveBeenCalled();
  });

  it('getAllSavingsGoals hides other-household envelopes and unsigned reads throw', async () => {
    mockRows.set('mine', {
      id: 'mine',
      name: 'Mine',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: 'hh1',
    });
    mockRows.set('legacy', {
      id: 'legacy',
      name: 'Legacy',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: null,
    });
    mockRows.set('theirs', {
      id: 'theirs',
      name: 'Theirs',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: 'hh-other',
    });

    const rows = await getAllSavingsGoals();
    expect(rows.map((g) => g.id).sort()).toEqual(['legacy', 'mine']);

    await setCurrentUserId(null);
    await expect(getAllSavingsGoals()).rejects.toThrow(/No authenticated user/);
    await expect(saveSavingsGoal(goal())).rejects.toThrow(/No authenticated user/);
  });

  it('deleteSavingsGoal does not remove another household row and skips cloud without hid', async () => {
    mockRows.set('g1', {
      id: 'g1',
      name: 'Keep',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: 'hh-other',
    });
    mockRows.set('g2', {
      id: 'g2',
      name: 'Gone',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: 'hh1',
    });

    await deleteSavingsGoal('g1');
    expect(mockRows.has('g1')).toBe(true);
    await deleteSavingsGoal('g2');
    expect(mockRows.has('g2')).toBe(false);
    expect(mockSyncSavingsGoalDeletionToCloud).toHaveBeenCalledWith('g2', 'hh1');

    mockSyncSavingsGoalDeletionToCloud.mockClear();
    mockRows.set('g3', {
      id: 'g3',
      name: 'Solo',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: null,
    });
    setCurrentHouseholdId(null);
    await deleteSavingsGoal('g3');
    expect(mockRows.has('g3')).toBe(false);
    expect(mockSyncSavingsGoalDeletionToCloud).not.toHaveBeenCalled();
  });

  it('deleteSavingsGoalFromCloud requires matching uid and household_id', async () => {
    mockRows.set('g1', {
      id: 'g1',
      name: 'Keep',
      target_usd: 1,
      allocated_usd: 0,
      notes: null,
      created_at: 'c',
      updated_at: 'c',
      user_id: 'user-1',
      household_id: 'hh1',
    });
    await deleteSavingsGoalFromCloud('g1', 'user-1', 'hh-other');
    expect(mockRows.has('g1')).toBe(true);
    await deleteSavingsGoalFromCloud('g1', 'user-2', 'hh1');
    expect(mockRows.has('g1')).toBe(true);
    await deleteSavingsGoalFromCloud('g1', 'user-1', 'hh1');
    expect(mockRows.has('g1')).toBe(false);
  });
});
