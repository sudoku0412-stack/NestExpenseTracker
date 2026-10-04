/**
 * Investment holdings are personal + local-only: scoped by user_id, removed
 * with their mockSnapshots, and wiped with the account.
 */

type Row = Record<string, unknown>;
const mockAccounts = new Map<string, Row>();
const mockSnapshots = new Map<string, Row>();
const mockRuns: { sql: string; params: unknown[] }[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM investment_accounts/i.test(sql)) {
        return [...mockAccounts.values()].filter((r) => r.user_id === params[0]);
      }
      if (/FROM investment_snapshots/i.test(sql)) {
        return [...mockSnapshots.values()]
          .filter((r) => r.account_id === params[0] && r.user_id === params[1])
          .sort((a, b) => String(b.date).localeCompare(String(a.date)));
      }
      return [];
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM investment_accounts/i.test(sql)) {
        const r = mockAccounts.get(params[0] as string);
        return r && r.user_id === params[1] ? r : null;
      }
      return null;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      mockRuns.push({ sql, params });
      if (/INSERT OR REPLACE INTO investment_accounts/i.test(sql)) {
        mockAccounts.set(params[0] as string, {
          id: params[0],
          name: params[1],
          kind: params[2],
          contributed_usd: params[3],
          value_usd: params[4],
          notes: params[5],
          created_at: params[6],
          updated_at: params[7],
          user_id: params[8],
        });
      } else if (/INSERT OR REPLACE INTO investment_snapshots/i.test(sql)) {
        mockSnapshots.set(params[0] as string, {
          id: params[0],
          account_id: params[1],
          date: params[2],
          value_usd: params[3],
          contributed_usd: params[4],
          created_at: params[5],
          user_id: params[6],
        });
      } else if (/DELETE FROM investment_snapshots WHERE account_id/i.test(sql)) {
        for (const [k, r] of mockSnapshots) if (r.account_id === params[0] && r.user_id === params[1]) mockSnapshots.delete(k);
      } else if (/DELETE FROM investment_accounts WHERE id/i.test(sql)) {
        const r = mockAccounts.get(params[0] as string);
        if (r && r.user_id === params[1]) mockAccounts.delete(params[0] as string);
      }
      return { lastInsertRowId: 0, changes: 1 };
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
  addInvestmentSnapshot,
  deleteAllReceipts,
  deleteInvestmentAccount,
  getAllInvestmentAccounts,
  getInvestmentAccountById,
  getInvestmentSnapshots,
  saveInvestmentAccount,
  setCurrentUserId,
} from '../../lib/database';
import type { InvestmentAccount } from '../../types';

const account = (o: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  id: 'a1',
  name: 'TFSA',
  kind: 'etf',
  contributedUsd: 1000,
  valueUsd: 1200,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

beforeEach(async () => {
  mockAccounts.clear();
  mockSnapshots.clear();
  mockRuns.length = 0;
  await setCurrentUserId('u1');
});

describe('investment accounts', () => {
  it('round-trips an account and scopes reads to the signed-in user', async () => {
    await saveInvestmentAccount(account());
    await saveInvestmentAccount(account({ id: 'a2', name: 'Crypto', kind: 'crypto' }));
    expect((await getAllInvestmentAccounts()).map((a) => a.id).sort()).toEqual(['a1', 'a2']);
    expect(await getInvestmentAccountById('a1')).toMatchObject({
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 1000,
      valueUsd: 1200,
    });

    await setCurrentUserId('u2');
    expect(await getAllInvestmentAccounts()).toEqual([]);
    expect(await getInvestmentAccountById('a1')).toBeNull();
  });

  it('refuses unsigned reads and writes', async () => {
    await setCurrentUserId(null);
    await expect(saveInvestmentAccount(account())).rejects.toThrow(/No authenticated user/);
    await expect(getAllInvestmentAccounts()).rejects.toThrow(/No authenticated user/);
    await expect(getInvestmentAccountById('a1')).rejects.toThrow(/No authenticated user/);
    await expect(addInvestmentSnapshot({
      id: 's1',
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 1,
      contributedUsd: 1,
      createdAt: '',
    })).rejects.toThrow(/No authenticated user/);
  });

  it('never syncs to the cloud or household (user-scoped SQL only)', async () => {
    await saveInvestmentAccount(account());
    const insert = mockRuns.find((r) => /INSERT OR REPLACE INTO investment_accounts/i.test(r.sql))!;
    expect(insert.sql).not.toMatch(/household_id/i);
    expect(insert.params[8]).toBe('u1');
  });

  it('saving an existing id updates it in place', async () => {
    await saveInvestmentAccount(account());
    await saveInvestmentAccount(account({ valueUsd: 1500 }));
    expect((await getAllInvestmentAccounts())).toHaveLength(1);
    expect((await getInvestmentAccountById('a1'))!.valueUsd).toBe(1500);
  });
});

describe('investment snapshots', () => {
  const snap = (id: string, date: string) => ({
    id,
    accountId: 'a1',
    date,
    valueUsd: 100,
    contributedUsd: 90,
    createdAt: '',
  });

  it('returns mockSnapshots newest first for the account and user only', async () => {
    await addInvestmentSnapshot(snap('s1', '2026-01-01'));
    await addInvestmentSnapshot(snap('s2', '2026-03-01'));
    await addInvestmentSnapshot({ ...snap('s3', '2026-02-01'), accountId: 'other' });
    expect((await getInvestmentSnapshots('a1')).map((s) => s.id)).toEqual(['s2', 's1']);
    await setCurrentUserId('u2');
    expect(await getInvestmentSnapshots('a1')).toEqual([]);
  });

  it('deleting an account removes its mockSnapshots too', async () => {
    await saveInvestmentAccount(account());
    await addInvestmentSnapshot(snap('s1', '2026-01-01'));
    await deleteInvestmentAccount('a1');
    expect(await getInvestmentAccountById('a1')).toBeNull();
    expect(await getInvestmentSnapshots('a1')).toEqual([]);
  });

  it('another user cannot delete your account', async () => {
    await saveInvestmentAccount(account());
    await setCurrentUserId('u2');
    await deleteInvestmentAccount('a1');
    await setCurrentUserId('u1');
    expect(await getInvestmentAccountById('a1')).not.toBeNull();
  });
});

describe('account deletion', () => {
  it('deleteAllReceipts also wipes the user investment data', async () => {
    await deleteAllReceipts();
    expect(mockRuns.some((r) => /DELETE FROM investment_snapshots WHERE user_id/i.test(r.sql) && r.params[0] === 'u1')).toBe(true);
    expect(mockRuns.some((r) => /DELETE FROM investment_accounts WHERE user_id/i.test(r.sql) && r.params[0] === 'u1')).toBe(true);
  });
});
