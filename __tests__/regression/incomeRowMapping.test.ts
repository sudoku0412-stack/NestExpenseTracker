/**
 * Income list/search reads go through rowToIncome + getRecentIncomeSourceNames.
 * A bad recurring_json parse, missing category, or case-insensitive source
 * chip collapsing the wrong name would silently corrupt cashflow and
 * add-income autocomplete. This mocks expo-sqlite with an in-memory
 * incomes table so the real database.ts mapping runs.
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

const mockIncomeRows: IncomeRow[] = [];

function mockLikeMatch(value: string | null, pattern: string): boolean {
  const raw = (value ?? '').toLowerCase();
  const needle = pattern.replace(/%/g, '');
  return raw.includes(needle);
}

function mockMatchesHousehold(row: IncomeRow, hid: string | undefined): boolean {
  if (!hid) return true;
  return row.household_id === null || row.household_id === hid;
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 0, changes: 0 })),
    getAllAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (!sql.includes('FROM incomes')) return [];
      const uid = params[0] as string;
      let rows = mockIncomeRows.filter((r) => r.user_id === uid);
      const { isInCalendarMonth } = require('../../lib/calendarDate');

      if (sql.includes('lower(source_name) LIKE')) {
        const q = params[1] as string;
        rows = rows.filter(
          (r) =>
            mockLikeMatch(r.source_name, q) ||
            mockLikeMatch(r.category, q) ||
            mockLikeMatch(r.notes, q),
        );
        const hid = params[4] as string | undefined;
        rows = rows.filter((r) => mockMatchesHousehold(r, hid));
      } else if (sql.includes('length(')) {
        const start = params[1] as string;
        const [year, month] = start.split('-').map(Number);
        const hid = params[5] as string | undefined;
        rows = rows.filter((r) => mockMatchesHousehold(r, hid) && isInCalendarMonth(r.date, year, month));
      } else {
        const hid = params[1] as string | undefined;
        rows = rows.filter((r) => mockMatchesHousehold(r, hid));
      }

      return [...rows].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (!sql.includes('FROM incomes')) return null;
      const [id, uid, hid] = params as [string, string, string?];
      return (
        mockIncomeRows.find(
          (r) => r.id === id && r.user_id === uid && mockMatchesHousehold(r, hid),
        ) ?? null
      );
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
  getAllIncomes,
  getIncomeById,
  getIncomesByMonth,
  getRecentIncomeSourceNames,
  searchIncomes,
  setCurrentHouseholdId,
  setCurrentUserId,
} from '../../lib/database';

function seed(overrides: Partial<IncomeRow>): IncomeRow {
  const row: IncomeRow = {
    id: 'inc-1',
    source_name: 'Acme payroll',
    date: '2026-03-15',
    amount_usd: 3200,
    category: 'Salary',
    earned_by: 'uid-self',
    notes: 'Net pay',
    original_currency: 'USD',
    recurring_json: null,
    created_by: 'uid-self',
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    household_id: 'hh1',
    is_recurring_occurrence: 0,
    user_id: 'user-1',
    ...overrides,
  };
  mockIncomeRows.push(row);
  return row;
}

beforeEach(async () => {
  mockIncomeRows.length = 0;
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('user-1');
});

describe('rowToIncome via income reads', () => {
  it('parses recurring JSON and flags generated occurrences', async () => {
    seed({
      id: 'inc-recurring',
      recurring_json: JSON.stringify({
        frequency: 'biweekly',
        nextDueDate: '2026-03-29',
        endDate: '2026-12-31',
      }),
      is_recurring_occurrence: 1,
    });

    const income = await getIncomeById('inc-recurring');
    expect(income).toMatchObject({
      id: 'inc-recurring',
      sourceName: 'Acme payroll',
      amountUsd: 3200,
      category: 'Salary',
      notes: 'Net pay',
      originalCurrency: 'USD',
      createdBy: 'uid-self',
      householdId: 'hh1',
      isRecurringOccurrence: true,
      recurring: {
        frequency: 'biweekly',
        nextDueDate: '2026-03-29',
        endDate: '2026-12-31',
      },
    });
  });

  it('drops corrupt recurring_json and falls back to Other when category is empty', async () => {
    seed({
      id: 'inc-bad',
      category: '',
      notes: null,
      original_currency: null,
      created_by: null,
      household_id: null,
      recurring_json: '{not-json',
      is_recurring_occurrence: 0,
    });

    const income = await getIncomeById('inc-bad');
    expect(income?.recurring).toBeUndefined();
    expect(income?.category).toBe('Other');
    expect(income?.notes).toBeUndefined();
    expect(income?.originalCurrency).toBeUndefined();
    expect(income?.createdBy).toBeUndefined();
    expect(income?.householdId).toBeUndefined();
    expect(income?.isRecurringOccurrence).toBe(false);
  });

  it('hides incomes that belong to another household', async () => {
    seed({ id: 'mine', household_id: 'hh1', source_name: 'Mine' });
    seed({ id: 'theirs', household_id: 'hh-other', source_name: 'Theirs' });

    const all = await getAllIncomes();
    expect(all.map((i) => i.id)).toEqual(['mine']);
    expect(await getIncomeById('theirs')).toBeNull();
  });

  it('searchIncomes matches source, category, or notes case-insensitively', async () => {
    seed({ id: 's1', source_name: 'Acme payroll', category: 'Salary', notes: null, date: '2026-03-02' });
    seed({ id: 's2', source_name: 'Uber', category: 'Side hustle', notes: 'weekend', date: '2026-03-01' });
    seed({ id: 's3', source_name: 'Gift', category: 'Gift', notes: 'birthday', date: '2026-02-01' });

    const bySource = await searchIncomes('ACME');
    expect(bySource.map((i) => i.id)).toEqual(['s1']);

    const byCategory = await searchIncomes('side hustle');
    expect(byCategory.map((i) => i.id)).toEqual(['s2']);

    const byNotes = await searchIncomes('Birthday');
    expect(byNotes.map((i) => i.id)).toEqual(['s3']);
  });

  it('getIncomesByMonth stays in the civil month and active household', async () => {
    seed({ id: 'in-month', date: '2026-03-15', household_id: 'hh1' });
    seed({ id: 'first', date: '2026-03-01', household_id: 'hh1' });
    seed({ id: 'prev', date: '2026-02-28', household_id: 'hh1' });
    seed({ id: 'next', date: '2026-04-01', household_id: 'hh1' });
    seed({ id: 'other-hh', date: '2026-03-20', household_id: 'hh-other' });

    const rows = await getIncomesByMonth(2026, 3);
    expect(rows.map((i) => i.id).sort()).toEqual(['first', 'in-month']);
  });
});

describe('getRecentIncomeSourceNames', () => {
  it('returns distinct names most-recent first, skipping blanks and case duplicates', async () => {
    seed({ id: 'a', source_name: 'Acme payroll', date: '2026-03-20' });
    seed({ id: 'b', source_name: '  ', date: '2026-03-19' });
    seed({ id: 'c', source_name: 'ACME PAYROLL', date: '2026-03-18' });
    seed({ id: 'd', source_name: 'Uber', date: '2026-03-17' });
    seed({ id: 'e', source_name: 'uber', date: '2026-03-16' });
    seed({ id: 'f', source_name: 'Venmo', date: '2026-03-15' });
    seed({ id: 'g', source_name: 'Gift', date: '2026-03-14' });

    await expect(getRecentIncomeSourceNames(2)).resolves.toEqual(['Acme payroll', 'Uber']);
    await expect(getRecentIncomeSourceNames(8)).resolves.toEqual([
      'Acme payroll',
      'Uber',
      'Venmo',
      'Gift',
    ]);
  });
});
