/**
 * Settlements are immutable settle-up payments. A duplicate Firestore
 * snapshot must INSERT OR IGNORE — never overwrite amount / from / to.
 * Household delete uses the *strict* getAllSettlementsForHousehold
 * path so a NULL-household leftover cannot hide or inflate balances.
 */

type SettlementRow = {
  id: string;
  from_uid: string;
  to_uid: string;
  amount_usd: number;
  created_at: string;
  user_id: string | null;
  household_id: string | null;
};

const mockSettlements = new Map<string, SettlementRow>();

function mockHidMode(sql: string): 'none' | 'loose' | 'strict' {
  if (/household_id IS NULL/i.test(sql)) return 'loose';
  if (/household_id\s*=\s*\?/i.test(sql)) return 'strict';
  return 'none';
}

function mockMatchesHid(row: SettlementRow, sql: string, params: unknown[]): boolean {
  const mode = mockHidMode(sql);
  if (mode === 'none') return true;
  const hid = params[params.length - 1] as string | null | undefined;
  if (mode === 'strict') return row.household_id === hid;
  return row.household_id === null || row.household_id === hid;
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async () => null),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!sql.includes('FROM settlements')) return [];
      const uid = params[0] as string;
      return [...mockSettlements.values()]
        .filter((r) => r.user_id === uid && mockMatchesHid(r, sql, params))
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0));
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT OR IGNORE INTO settlements/i.test(sql)) {
        const id = params[0] as string;
        if (mockSettlements.has(id)) {
          return { lastInsertRowId: 0, changes: 0 };
        }
        mockSettlements.set(id, {
          id,
          from_uid: params[1] as string,
          to_uid: params[2] as string,
          amount_usd: params[3] as number,
          created_at: params[4] as string,
          user_id: params[5] as string,
          household_id: (params[6] as string | null) ?? null,
        });
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/INSERT INTO settlements/i.test(sql)) {
        const id = params[0] as string;
        mockSettlements.set(id, {
          id,
          from_uid: params[1] as string,
          to_uid: params[2] as string,
          amount_usd: params[3] as number,
          created_at: params[4] as string,
          user_id: params[5] as string,
          household_id: (params[6] as string | null) ?? null,
        });
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/UPDATE settlements SET household_id/i.test(sql)) {
        const hid = params[0] as string;
        const uid = params[1] as string;
        for (const row of mockSettlements.values()) {
          if (row.user_id === uid && row.household_id === null) {
            row.household_id = hid;
          }
        }
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
  bootstrapHouseholdId,
  getAllSettlements,
  getAllSettlementsForHousehold,
  insertSettlement,
  setCurrentHouseholdId,
  setCurrentUserId,
  upsertSettlementFromCloud,
} from '../../lib/database';
import { syncSettlementToCloud } from '../../lib/cloudSync';
import { Settlement } from '../../types';

const mockSyncSettlementToCloud = syncSettlementToCloud as jest.Mock;

function settlement(overrides: Partial<Settlement> = {}): Settlement {
  return {
    id: 's1',
    fromUid: 'alice',
    toUid: 'bob',
    amountUsd: 40,
    createdAt: '2026-03-15T00:00:00.000Z',
    ...overrides,
  };
}

function seed(overrides: Partial<SettlementRow> = {}): SettlementRow {
  const row: SettlementRow = {
    id: 's1',
    from_uid: 'alice',
    to_uid: 'bob',
    amount_usd: 40,
    created_at: '2026-03-15T00:00:00.000Z',
    user_id: 'user-1',
    household_id: 'hh1',
    ...overrides,
  };
  mockSettlements.set(row.id, row);
  return row;
}

beforeEach(async () => {
  mockSettlements.clear();
  mockSyncSettlementToCloud.mockClear();
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('user-1');
});

describe('upsertSettlementFromCloud', () => {
  it('inserts a new settlement stamped with the listener uid + household', async () => {
    await upsertSettlementFromCloud(settlement(), 'user-1', 'hh1');
    expect(mockSettlements.get('s1')).toEqual({
      id: 's1',
      from_uid: 'alice',
      to_uid: 'bob',
      amount_usd: 40,
      created_at: '2026-03-15T00:00:00.000Z',
      user_id: 'user-1',
      household_id: 'hh1',
    });
  });

  it('ignores a duplicate delivery so amount / parties cannot drift', async () => {
    seed({ amount_usd: 40, from_uid: 'alice', to_uid: 'bob' });

    await upsertSettlementFromCloud(
      settlement({ amountUsd: 999, fromUid: 'eve', toUid: 'mallory', createdAt: '2099-01-01T00:00:00.000Z' }),
      'user-1',
      'hh1',
    );

    expect(mockSettlements.get('s1')).toMatchObject({
      amount_usd: 40,
      from_uid: 'alice',
      to_uid: 'bob',
      created_at: '2026-03-15T00:00:00.000Z',
    });
  });
});

describe('insertSettlement', () => {
  it('stamps user_id + household_id and shadow-writes after the local insert', async () => {
    await insertSettlement(settlement({ id: 'new-s' }));
    expect(mockSettlements.get('new-s')).toMatchObject({
      from_uid: 'alice',
      to_uid: 'bob',
      amount_usd: 40,
      user_id: 'user-1',
      household_id: 'hh1',
    });
    expect(mockSyncSettlementToCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-s', amountUsd: 40 }),
      'hh1',
    );
  });

  it('skips the cloud shadow-write when there is no active household', async () => {
    setCurrentHouseholdId(null);
    await insertSettlement(settlement({ id: 'local-only' }));
    expect(mockSettlements.get('local-only')!.household_id).toBeNull();
    expect(mockSyncSettlementToCloud).not.toHaveBeenCalled();
  });

  it('throws when inserting with no signed-in user', async () => {
    await setCurrentUserId(null);
    await expect(insertSettlement(settlement())).rejects.toThrow(/No authenticated user/);
    expect(mockSettlements.size).toBe(0);
  });
});

describe('household isolation', () => {
  it('getAllSettlements shows current-household and un-backfilled NULL rows only', async () => {
    seed({ id: 'mine', household_id: 'hh1' });
    seed({ id: 'legacy', household_id: null });
    seed({ id: 'theirs', household_id: 'hh-other' });

    const all = await getAllSettlements();
    expect(all.map((s) => s.id).sort()).toEqual(['legacy', 'mine']);
  });

  it('getAllSettlementsForHousehold uses strict household_id equality (no NULL leak)', async () => {
    seed({ id: 'mine', household_id: 'hh1' });
    seed({ id: 'legacy', household_id: null });
    seed({ id: 'other', household_id: 'hh-other' });

    const rows = await getAllSettlementsForHousehold('hh1');
    expect(rows.map((s) => s.id)).toEqual(['mine']);
  });

  it('throws when reading settlements with no signed-in user', async () => {
    await setCurrentUserId(null);
    await expect(getAllSettlements()).rejects.toThrow(/No authenticated user/);
    await expect(getAllSettlementsForHousehold('hh1')).rejects.toThrow(/No authenticated user/);
  });
});

describe('household-unset settlement isolation', () => {
  it('getAllSettlements still hides other uids and includes this user\'s other-household + NULL-hid rows', async () => {
    setCurrentHouseholdId(null);
    seed({ id: 'mine-hh', user_id: 'user-1', household_id: 'hh1' });
    seed({ id: 'mine-other-hh', user_id: 'user-1', household_id: 'hh-other' });
    seed({ id: 'mine-null', user_id: 'user-1', household_id: null });
    seed({ id: 'theirs', user_id: 'user-2', household_id: 'hh1' });

    const ids = (await getAllSettlements()).map((s) => s.id).sort();
    expect(ids).toEqual(['mine-hh', 'mine-null', 'mine-other-hh']);
  });

  it('getAllSettlementsForHousehold stays strict even when the active household is unset', async () => {
    setCurrentHouseholdId(null);
    seed({ id: 'hh1', user_id: 'user-1', household_id: 'hh1' });
    seed({ id: 'legacy', user_id: 'user-1', household_id: null });
    seed({ id: 'other', user_id: 'user-1', household_id: 'hh-other' });
    seed({ id: 'theirs', user_id: 'user-2', household_id: 'hh1' });

    const rows = await getAllSettlementsForHousehold('hh1');
    expect(rows.map((s) => s.id)).toEqual(['hh1']);
  });
});

describe('bootstrapHouseholdId settlement backfill', () => {
  it('claims only this user\'s NULL-household settlements', async () => {
    seed({ id: 'legacy', user_id: 'user-1', household_id: null });
    seed({ id: 'stamped', user_id: 'user-1', household_id: 'hh-old' });
    seed({ id: 'other-user', user_id: 'user-2', household_id: null });

    await bootstrapHouseholdId('user-1', 'hh1');

    expect(mockSettlements.get('legacy')!.household_id).toBe('hh1');
    expect(mockSettlements.get('stamped')!.household_id).toBe('hh-old');
    expect(mockSettlements.get('other-user')!.household_id).toBeNull();
  });
});
