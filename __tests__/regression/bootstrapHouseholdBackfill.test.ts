/**
 * bootstrapHouseholdId claims this user's household_id-NULL rows so
 * householdFilterSql's `OR household_id IS NULL` fallback does not keep
 * leaking them into every later household on the device. Settlements
 * already have this coverage; receipts / incomes / savings_goals did not.
 */

type ScopedRow = { id: string; user_id: string; household_id: string | null };

const mockReceipts = new Map<string, ScopedRow & Record<string, unknown>>();
const mockIncomes = new Map<string, ScopedRow & Record<string, unknown>>();
const mockGoals = new Map<string, ScopedRow & Record<string, unknown>>();

let mockThrowOnBackfill = false;

function mockHidMode(sql: string): 'none' | 'loose' | 'strict' {
  if (/household_id IS NULL/i.test(sql)) return 'loose';
  if (/household_id\s*=\s*\?/i.test(sql)) return 'strict';
  return 'none';
}

function mockMatchesHid(row: ScopedRow, sql: string, params: unknown[]): boolean {
  const mode = mockHidMode(sql);
  if (mode === 'none') return true;
  const hid = params[params.length - 1] as string | null | undefined;
  if (mode === 'strict') return row.household_id === hid;
  return row.household_id === null || row.household_id === hid;
}

function mockApplyHouseholdBackfill(table: Map<string, ScopedRow>, hid: string, uid: string): void {
  for (const row of table.values()) {
    if (row.user_id === uid && row.household_id === null) {
      row.household_id = hid;
    }
  }
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getFirstAsync: jest.fn(async () => null),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM line_items')) return [];
      if (sql.includes('FROM receipts')) {
        const uid = params[0] as string;
        return [...mockReceipts.values()].filter(
          (r) => r.user_id === uid && mockMatchesHid(r, sql, params),
        );
      }
      if (sql.includes('FROM incomes')) {
        const uid = params[0] as string;
        return [...mockIncomes.values()].filter(
          (r) => r.user_id === uid && mockMatchesHid(r, sql, params),
        );
      }
      if (sql.includes('FROM savings_goals')) {
        const uid = params[0] as string;
        return [...mockGoals.values()].filter(
          (r) => r.user_id === uid && mockMatchesHid(r, sql, params),
        );
      }
      return [];
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/UPDATE (receipts|settlements|incomes|savings_goals) SET household_id/i.test(sql)) {
        if (mockThrowOnBackfill) {
          throw new Error('simulated backfill failure');
        }
        const hid = params[0] as string;
        const uid = params[1] as string;
        if (/UPDATE receipts SET household_id/i.test(sql)) mockApplyHouseholdBackfill(mockReceipts, hid, uid);
        if (/UPDATE incomes SET household_id/i.test(sql)) mockApplyHouseholdBackfill(mockIncomes, hid, uid);
        if (/UPDATE savings_goals SET household_id/i.test(sql)) mockApplyHouseholdBackfill(mockGoals, hid, uid);
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
  getAllIncomes,
  getAllReceipts,
  getAllSavingsGoals,
  setCurrentHouseholdId,
  setCurrentUserId,
} from '../../lib/database';

function receipt(overrides: Partial<ScopedRow> & Record<string, unknown> = {}) {
  const row = {
    id: 'r-legacy',
    store_name: 'Costco',
    date: '2026-03-01',
    total_amount: 40,
    subtotal_amount: 36,
    tax_amount: 4,
    category: 'Groceries',
    category_tags: null,
    raw_text: null,
    image_uri: null,
    photo_url: null,
    notes: null,
    split_json: null,
    recurring_json: null,
    original_currency: 'USD',
    fx_rate: null,
    paid_by: null,
    created_by: 'user-1',
    is_recurring_occurrence: 0,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    user_id: 'user-1',
    household_id: null,
    ...overrides,
  };
  mockReceipts.set(row.id as string, row as ScopedRow & Record<string, unknown>);
}

function income(overrides: Partial<ScopedRow> & Record<string, unknown> = {}) {
  const row = {
    id: 'i-legacy',
    source_name: 'Payroll',
    date: '2026-03-01',
    amount_usd: 3200,
    category: 'Salary',
    earned_by: 'user-1',
    notes: null,
    original_currency: 'USD',
    recurring_json: null,
    created_by: 'user-1',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    is_recurring_occurrence: 0,
    user_id: 'user-1',
    household_id: null,
    ...overrides,
  };
  mockIncomes.set(row.id as string, row as ScopedRow & Record<string, unknown>);
}

function goal(overrides: Partial<ScopedRow> & Record<string, unknown> = {}) {
  const row = {
    id: 'g-legacy',
    name: 'Emergency',
    target_usd: 1000,
    allocated_usd: 100,
    notes: null,
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    user_id: 'user-1',
    household_id: null,
    ...overrides,
  };
  mockGoals.set(row.id as string, row as ScopedRow & Record<string, unknown>);
}

beforeEach(async () => {
  mockReceipts.clear();
  mockIncomes.clear();
  mockGoals.clear();
  mockThrowOnBackfill = false;
  setCurrentHouseholdId(null);
  await setCurrentUserId('user-1');
});

describe('bootstrapHouseholdId backfill', () => {
  it('stamps this user\'s NULL-household receipts, incomes, and savings goals', async () => {
    receipt({ id: 'r-null' });
    income({ id: 'i-null' });
    goal({ id: 'g-null' });

    await bootstrapHouseholdId('user-1', 'hh1');

    expect(mockReceipts.get('r-null')!.household_id).toBe('hh1');
    expect(mockIncomes.get('i-null')!.household_id).toBe('hh1');
    expect(mockGoals.get('g-null')!.household_id).toBe('hh1');
  });

  it('leaves already-stamped rows and other users\' NULL rows alone', async () => {
    receipt({ id: 'r-stamped', household_id: 'hh-old' });
    receipt({ id: 'r-other', user_id: 'user-2', household_id: null });
    income({ id: 'i-stamped', household_id: 'hh-old' });
    income({ id: 'i-other', user_id: 'user-2', household_id: null });
    goal({ id: 'g-stamped', household_id: 'hh-old' });
    goal({ id: 'g-other', user_id: 'user-2', household_id: null });

    await bootstrapHouseholdId('user-1', 'hh1');

    expect(mockReceipts.get('r-stamped')!.household_id).toBe('hh-old');
    expect(mockReceipts.get('r-other')!.household_id).toBeNull();
    expect(mockIncomes.get('i-stamped')!.household_id).toBe('hh-old');
    expect(mockIncomes.get('i-other')!.household_id).toBeNull();
    expect(mockGoals.get('g-stamped')!.household_id).toBe('hh-old');
    expect(mockGoals.get('g-other')!.household_id).toBeNull();
  });

  it('stops claimed rows from leaking into a later household via the NULL fallback', async () => {
    receipt({ id: 'r-legacy' });
    income({ id: 'i-legacy' });
    goal({ id: 'g-legacy' });

    await bootstrapHouseholdId('user-1', 'hh1');
    expect((await getAllReceipts()).map((r) => r.id)).toEqual(['r-legacy']);
    expect((await getAllIncomes()).map((i) => i.id)).toEqual(['i-legacy']);
    expect((await getAllSavingsGoals()).map((g) => g.id)).toEqual(['g-legacy']);

    setCurrentHouseholdId('hh-other');
    expect(await getAllReceipts()).toEqual([]);
    expect(await getAllIncomes()).toEqual([]);
    expect(await getAllSavingsGoals()).toEqual([]);
  });

  it('logs and leaves NULL rows unclaimed when the UPDATE fails', async () => {
    receipt({ id: 'r-fail' });
    mockThrowOnBackfill = true;
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await bootstrapHouseholdId('user-1', 'hh1');

    expect(mockReceipts.get('r-fail')!.household_id).toBeNull();
    expect(warn).toHaveBeenCalledWith(
      '[database] backfillHouseholdIdForRows failed:',
      'simulated backfill failure',
    );
    // Active household is still set, so the NULL fallback keeps showing the row.
    expect((await getAllReceipts()).map((r) => r.id)).toEqual(['r-fail']);
    warn.mockRestore();
  });
});
