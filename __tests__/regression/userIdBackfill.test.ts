/**
 * setCurrentUserId claims pre-migration rows whose user_id is still
 * NULL. That UPDATE is scoped only to receipts + receipt_corrections
 * and only to NULL rows — a second account on the same device must
 * not inherit the first user's already-stamped data, and incomes /
 * settlements / goals / investments are never part of this claim
 * (those tables were added after per-user isolation).
 */

type ReceiptRow = { id: string; user_id: string | null };
type CorrectionRow = { id: string; user_id: string | null };
type GenericRow = { id: string; user_id: string | null };

const mockReceipts: ReceiptRow[] = [];
const mockCorrections: CorrectionRow[] = [];
const mockIncomes: GenericRow[] = [];
const mockSettlements: GenericRow[] = [];
const mockGoals: GenericRow[] = [];
const mockInvestments: GenericRow[] = [];
const mockUpdates: { table: string; sql: string; params: unknown[] }[] = [];

function mockTableFromUpdate(sql: string): string {
  const m = sql.match(/UPDATE\s+(\w+)/i);
  return m ? m[1] : 'unknown';
}

function mockClaimNullUserId(rows: { user_id: string | null }[], uid: string): number {
  let n = 0;
  for (const row of rows) {
    if (row.user_id === null) {
      row.user_id = uid;
      n += 1;
    }
  }
  return n;
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!/UPDATE/i.test(sql)) return { lastInsertRowId: 0, changes: 0 };
      const table = mockTableFromUpdate(sql);
      mockUpdates.push({ table, sql, params });
      const uid = params[0] as string;
      const onlyNull = /user_id IS NULL/i.test(sql);
      if (!onlyNull) {
        throw new Error(`backfill must keep the user_id IS NULL predicate: ${sql}`);
      }
      const tables: Record<string, { user_id: string | null }[]> = {
        receipts: mockReceipts,
        receipt_corrections: mockCorrections,
        incomes: mockIncomes,
        settlements: mockSettlements,
        savings_goals: mockGoals,
        investment_accounts: mockInvestments,
        investment_snapshots: mockInvestments,
      };
      const rows = tables[table];
      const changes = rows ? mockClaimNullUserId(rows, uid) : 0;
      return { lastInsertRowId: 0, changes };
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

import { setCurrentUserId } from '../../lib/database';

function seed(): void {
  mockReceipts.splice(
    0,
    mockReceipts.length,
    { id: 'legacy', user_id: null },
    { id: 'mine', user_id: 'u1' },
    { id: 'theirs', user_id: 'u2' },
  );
  mockCorrections.splice(
    0,
    mockCorrections.length,
    { id: 'c-legacy', user_id: null },
    { id: 'c-theirs', user_id: 'u2' },
  );
  mockIncomes.splice(0, mockIncomes.length, { id: 'inc-legacy', user_id: null });
  mockSettlements.splice(0, mockSettlements.length, { id: 'set-legacy', user_id: null });
  mockGoals.splice(0, mockGoals.length, { id: 'goal-legacy', user_id: null });
  mockInvestments.splice(0, mockInvestments.length, { id: 'inv-legacy', user_id: null });
  mockUpdates.length = 0;
}

describe('setCurrentUserId user_id backfill', () => {
  beforeEach(async () => {
    seed();
    await setCurrentUserId(null);
    mockUpdates.length = 0;
  });

  it('claims only NULL-user receipts and corrections for the first signed-in user', async () => {
    await setCurrentUserId('u1');

    expect(mockReceipts).toEqual([
      { id: 'legacy', user_id: 'u1' },
      { id: 'mine', user_id: 'u1' },
      { id: 'theirs', user_id: 'u2' },
    ]);
    expect(mockCorrections).toEqual([
      { id: 'c-legacy', user_id: 'u1' },
      { id: 'c-theirs', user_id: 'u2' },
    ]);
    expect(mockUpdates.map((u) => u.table).sort()).toEqual(['receipt_corrections', 'receipts']);
    expect(mockUpdates.every((u) => u.params[0] === 'u1')).toBe(true);
  });

  it('does not steal already-stamped rows when a second user signs in', async () => {
    await setCurrentUserId('u1');
    mockUpdates.length = 0;

    await setCurrentUserId('u3');

    expect(mockReceipts.find((r) => r.id === 'legacy')?.user_id).toBe('u1');
    expect(mockReceipts.find((r) => r.id === 'theirs')?.user_id).toBe('u2');
    expect(mockCorrections.find((r) => r.id === 'c-legacy')?.user_id).toBe('u1');
    expect(mockUpdates.every((u) => /user_id IS NULL/i.test(u.sql))).toBe(true);
  });

  it('does not claim incomes, settlements, savings goals, or investments', async () => {
    await setCurrentUserId('u1');

    expect(mockIncomes[0].user_id).toBeNull();
    expect(mockSettlements[0].user_id).toBeNull();
    expect(mockGoals[0].user_id).toBeNull();
    expect(mockInvestments[0].user_id).toBeNull();
    expect(mockUpdates.some((u) => /incomes|settlements|savings_goals|investment/i.test(u.table))).toBe(
      false,
    );
  });

  it('does not run the backfill when signing out', async () => {
    await setCurrentUserId('u1');
    mockUpdates.length = 0;
    await setCurrentUserId(null);
    expect(mockUpdates).toEqual([]);
  });
});
