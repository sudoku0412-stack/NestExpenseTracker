/**
 * Local income save/delete is the cashflow write path. A missed uid/hid
 * filter would wipe another household's paycheck, and a shadow-write when
 * hid is null would send a row to Firestore with no partition. Cloud
 * listener deletes must stay strict (no NULL-household fallback).
 */

type IncomeRow = {
  id: string;
  source_name: string;
  date: string;
  amount_usd: number;
  category: string;
  earned_by: string;
  notes: string | null;
  original_currency: string | null;
  recurring_json: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  household_id: string | null;
  is_recurring_occurrence: number | null;
  user_id: string;
};

const mockIncomeRows = new Map<string, IncomeRow>();

function mockHidMode(sql: string): 'none' | 'loose' | 'strict' {
  if (/household_id IS NULL/i.test(sql)) return 'loose';
  if (/household_id\s*=\s*\?/i.test(sql)) return 'strict';
  return 'none';
}

function mockMatchesHid(row: IncomeRow, sql: string, params: unknown[]): boolean {
  const mode = mockHidMode(sql);
  if (mode === 'none') return true;
  const hid = params[params.length - 1] as string | null | undefined;
  if (mode === 'strict') return row.household_id === hid;
  return row.household_id === null || row.household_id === hid;
}

function mockLikeMatch(value: string | null, pattern: string): boolean {
  const raw = (value ?? '').toLowerCase();
  const needle = pattern.replace(/%/g, '');
  return raw.includes(needle);
}

function mockRowFromInsertParams(params: unknown[]): IncomeRow {
  return {
    id: params[0] as string,
    source_name: params[1] as string,
    date: params[2] as string,
    amount_usd: params[3] as number,
    category: params[4] as string,
    earned_by: params[5] as string,
    notes: (params[6] as string | null) ?? null,
    original_currency: (params[7] as string | null) ?? null,
    recurring_json: (params[8] as string | null) ?? null,
    created_by: (params[9] as string | null) ?? null,
    created_at: params[10] as string,
    updated_at: params[11] as string,
    user_id: params[12] as string,
    household_id: (params[13] as string | null) ?? null,
    is_recurring_occurrence: (params[14] as number | null) ?? 0,
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (!sql.includes('FROM incomes')) return [];
      const uid = params[0] as string;
      let rows = [...mockIncomeRows.values()].filter(
        (r) => r.user_id === uid && mockMatchesHid(r, sql, params),
      );
      if (sql.includes('lower(source_name) LIKE')) {
        const q = params[1] as string;
        rows = rows.filter(
          (r) =>
            mockLikeMatch(r.source_name, q) ||
            mockLikeMatch(r.category, q) ||
            mockLikeMatch(r.notes, q),
        );
      }
      return rows.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT updated_at FROM incomes')) {
        return mockIncomeRows.get(params[0] as string)
          ? { updated_at: mockIncomeRows.get(params[0] as string)!.updated_at }
          : null;
      }
      if (!sql.includes('FROM incomes')) return null;
      const [id, uid] = params as [string, string];
      const row = mockIncomeRows.get(id);
      if (!row || row.user_id !== uid) return null;
      return mockMatchesHid(row, sql, params) ? row : null;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (/DELETE FROM incomes/i.test(sql)) {
        const id = params[0] as string;
        const uid = params[1] as string;
        const row = mockIncomeRows.get(id);
        if (row && row.user_id === uid && mockMatchesHid(row, sql, params)) {
          mockIncomeRows.delete(id);
          return { lastInsertRowId: 0, changes: 1 };
        }
        return { lastInsertRowId: 0, changes: 0 };
      }
      if (/INSERT OR REPLACE INTO incomes/i.test(sql)) {
        const row = mockRowFromInsertParams(params);
        mockIncomeRows.set(row.id, row);
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
  deleteIncome,
  deleteIncomeFromCloud,
  getAllIncomes,
  getIncomeById,
  saveIncome,
  searchIncomes,
  setCurrentHouseholdId,
  setCurrentUserId,
} from '../../lib/database';
import { syncIncomeDeletionToCloud, syncIncomeToCloud } from '../../lib/cloudSync';
import { Income } from '../../types';

const mockSyncIncomeToCloud = syncIncomeToCloud as jest.Mock;
const mockSyncIncomeDeletionToCloud = syncIncomeDeletionToCloud as jest.Mock;

function income(overrides: Partial<Income> = {}): Income {
  return {
    id: 'inc-1',
    sourceName: 'Acme payroll',
    date: '2026-03-15',
    amountUsd: 3200,
    category: 'Salary',
    earnedBy: 'uid-self',
    createdAt: '2026-03-15T00:00:00.000Z',
    updatedAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

function seed(overrides: Partial<IncomeRow> = {}): IncomeRow {
  const row: IncomeRow = {
    id: 'inc-1',
    source_name: 'Acme payroll',
    date: '2026-03-15',
    amount_usd: 3200,
    category: 'Salary',
    earned_by: 'uid-self',
    notes: null,
    original_currency: null,
    recurring_json: null,
    created_by: 'uid-self',
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    household_id: 'hh1',
    is_recurring_occurrence: 0,
    user_id: 'user-1',
    ...overrides,
  };
  mockIncomeRows.set(row.id, row);
  return row;
}

beforeEach(async () => {
  mockIncomeRows.clear();
  mockSyncIncomeToCloud.mockClear();
  mockSyncIncomeDeletionToCloud.mockClear();
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('user-1');
});

describe('saveIncome', () => {
  it('stamps uid + active household and shadow-writes to cloud', async () => {
    await saveIncome(income({ notes: 'Net pay', originalCurrency: 'USD' }));

    expect(mockIncomeRows.get('inc-1')).toMatchObject({
      source_name: 'Acme payroll',
      amount_usd: 3200,
      user_id: 'user-1',
      household_id: 'hh1',
      notes: 'Net pay',
      original_currency: 'USD',
    });
    expect(mockSyncIncomeToCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'inc-1', amountUsd: 3200 }),
      'hh1',
    );
  });

  it('skips the cloud shadow-write when there is no active household', async () => {
    setCurrentHouseholdId(null);
    await saveIncome(income());

    expect(mockIncomeRows.get('inc-1')?.household_id).toBeNull();
    expect(mockSyncIncomeToCloud).not.toHaveBeenCalled();
  });

  it('throws when unsigned', async () => {
    await setCurrentUserId(null);
    await expect(saveIncome(income())).rejects.toThrow(/No authenticated user/);
    expect(mockIncomeRows.size).toBe(0);
    expect(mockSyncIncomeToCloud).not.toHaveBeenCalled();
  });
});

describe('deleteIncome', () => {
  it('deletes only the matching uid + household row and syncs that id', async () => {
    seed({ id: 'mine', household_id: 'hh1' });
    seed({ id: 'theirs', household_id: 'hh-other' });
    seed({ id: 'other-user', user_id: 'user-2', household_id: 'hh1' });

    await deleteIncome('mine');
    await deleteIncome('theirs');
    await deleteIncome('other-user');

    expect(mockIncomeRows.has('mine')).toBe(false);
    expect(mockIncomeRows.has('theirs')).toBe(true);
    expect(mockIncomeRows.has('other-user')).toBe(true);
    expect(mockSyncIncomeDeletionToCloud).toHaveBeenCalledTimes(3);
    expect(mockSyncIncomeDeletionToCloud).toHaveBeenCalledWith('mine', 'hh1');
  });

  it('skips the cloud deletion when hid is null even if a local row is removed', async () => {
    seed({ id: 'legacy', household_id: null });
    setCurrentHouseholdId(null);

    await deleteIncome('legacy');

    expect(mockIncomeRows.has('legacy')).toBe(false);
    expect(mockSyncIncomeDeletionToCloud).not.toHaveBeenCalled();
  });

  it('throws when unsigned and does not touch rows', async () => {
    seed();
    await setCurrentUserId(null);
    await expect(deleteIncome('inc-1')).rejects.toThrow(/No authenticated user/);
    expect(mockIncomeRows.has('inc-1')).toBe(true);
  });
});

describe('deleteIncomeFromCloud', () => {
  it('is strict household+uid — must not drop NULL or other-household rows', async () => {
    seed({ id: 'mine', household_id: 'hh1' });
    seed({ id: 'legacy', household_id: null });
    seed({ id: 'other-hh', household_id: 'hh-other' });
    seed({ id: 'other-user', user_id: 'user-2', household_id: 'hh1' });

    await deleteIncomeFromCloud('mine', 'user-1', 'hh1');
    await deleteIncomeFromCloud('legacy', 'user-1', 'hh1');
    await deleteIncomeFromCloud('other-hh', 'user-1', 'hh1');
    await deleteIncomeFromCloud('other-user', 'user-1', 'hh1');

    expect(mockIncomeRows.has('mine')).toBe(false);
    expect(mockIncomeRows.has('legacy')).toBe(true);
    expect(mockIncomeRows.has('other-hh')).toBe(true);
    expect(mockIncomeRows.has('other-user')).toBe(true);
  });
});

describe('searchIncomes household isolation', () => {
  it('does not return another household’s matching source name', async () => {
    seed({ id: 'mine', source_name: 'Acme payroll', household_id: 'hh1' });
    seed({ id: 'theirs', source_name: 'Acme payroll', household_id: 'hh-other' });

    const hits = await searchIncomes('acme');
    expect(hits.map((i) => i.id)).toEqual(['mine']);
    expect(await getIncomeById('theirs')).toBeNull();
    expect((await getAllIncomes()).map((i) => i.id)).toEqual(['mine']);
  });
});
