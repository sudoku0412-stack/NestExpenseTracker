/**
 * Account delete must wipe local incomes as well as receipts.
 */

const runs: { sql: string; params: unknown[] }[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      runs.push({ sql, params });
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

import { deleteAllReceipts, deleteAllRowsForHousehold, setCurrentUserId } from '../../lib/database';

beforeEach(async () => {
  runs.length = 0;
  await setCurrentUserId('u-delete');
  runs.length = 0;
});

describe('deleteAllReceipts', () => {
  it('deletes the signed-in user incomes in the same transaction', async () => {
    await deleteAllReceipts();
    const incomeDelete = runs.find((r) => /DELETE FROM incomes/i.test(r.sql));
    expect(incomeDelete).toBeDefined();
    expect(incomeDelete!.params).toEqual(['u-delete']);
    const goalsDelete = runs.find((r) => /DELETE FROM savings_goals/i.test(r.sql));
    expect(goalsDelete).toBeDefined();
    expect(goalsDelete!.params).toEqual(['u-delete']);
  });
});

describe('deleteAllRowsForHousehold', () => {
  it('wipes household savings envelopes with incomes', async () => {
    await deleteAllRowsForHousehold('hh-gone');
    const goalsDelete = runs.find((r) => /DELETE FROM savings_goals/i.test(r.sql));
    expect(goalsDelete).toBeDefined();
    expect(goalsDelete!.params).toEqual(['hh-gone']);
    const incomeDelete = runs.find((r) => /DELETE FROM incomes/i.test(r.sql));
    expect(incomeDelete).toBeDefined();
    expect(incomeDelete!.params).toEqual(['hh-gone']);
  });

  it('wipes receipts, line items and settlements for that household only', async () => {
    await deleteAllRowsForHousehold('hh-gone');
    expect(runs.some((r) => /DELETE FROM receipts WHERE household_id/i.test(r.sql) && r.params[0] === 'hh-gone')).toBe(
      true,
    );
    expect(runs.some((r) => /DELETE FROM settlements WHERE household_id/i.test(r.sql) && r.params[0] === 'hh-gone')).toBe(
      true,
    );
    expect(runs.some((r) => /DELETE FROM line_items/i.test(r.sql) && r.params[0] === 'hh-gone')).toBe(true);
  });

  it('does not delete personal investment holdings (they are user-scoped, not household)', async () => {
    await deleteAllRowsForHousehold('hh-gone');
    expect(runs.some((r) => /investment_accounts/i.test(r.sql))).toBe(false);
    expect(runs.some((r) => /investment_snapshots/i.test(r.sql))).toBe(false);
    expect(runs.some((r) => /DELETE FROM profiles/i.test(r.sql))).toBe(false);
  });
});
