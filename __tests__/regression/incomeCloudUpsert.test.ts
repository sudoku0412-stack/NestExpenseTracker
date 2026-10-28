/**
 * A stale Firestore snapshot must not overwrite a newer local income.
 * syncIncomeToCloud is fire-and-forget; if the app dies before that
 * write lands, the next listener delivers the old doc.
 */

type IncomeRow = Record<string, string | number | null>;

const mockRows = new Map<string, IncomeRow>();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async (_sql: string, params: string[]) => mockRows.get(params[0]) ?? null),
    runAsync: jest.fn(async (_sql: string, params: unknown[]) => {
      const id = params[0] as string;
      mockRows.set(id, {
        id,
        source_name: params[1] as string,
        amount_usd: params[3] as number,
        earned_by: params[5] as string,
        recurring_json: params[8] as string | null,
        created_by: params[9] as string | null,
        updated_at: params[11] as string,
        user_id: params[12] as string,
        household_id: params[13] as string | null,
        is_recurring_occurrence: params[14] as number,
      });
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

import { upsertIncomeFromCloud } from '../../lib/database';
import { Income } from '../../types';

function income(overrides: Partial<Income>): Income {
  return {
    id: 'inc-1',
    sourceName: 'Payroll',
    date: '2026-03-01',
    amountUsd: 100,
    category: 'Salary',
    earnedBy: 'uid-a',
    createdAt: '2026-03-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('upsertIncomeFromCloud', () => {
  beforeEach(() => {
    mockRows.clear();
  });

  it('keeps a newer local income when the cloud snapshot is older', async () => {
    mockRows.set('inc-1', {
      id: 'inc-1',
      source_name: 'Side gig',
      amount_usd: 250,
      earned_by: 'uid-b',
      updated_at: '2026-03-02T12:00:00.000Z',
    });

    await upsertIncomeFromCloud(
      income({
        sourceName: 'Old payroll',
        amountUsd: 100,
        earnedBy: 'uid-a',
        updatedAt: '2026-03-01T00:00:00.000Z',
      }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('inc-1')).toMatchObject({
      source_name: 'Side gig',
      amount_usd: 250,
      earned_by: 'uid-b',
      updated_at: '2026-03-02T12:00:00.000Z',
    });
  });

  it('applies a cloud snapshot that is newer than the local row', async () => {
    mockRows.set('inc-1', {
      id: 'inc-1',
      source_name: 'Old',
      amount_usd: 10,
      earned_by: 'uid-a',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    await upsertIncomeFromCloud(
      income({
        sourceName: 'Updated',
        amountUsd: 400,
        earnedBy: 'uid-b',
        updatedAt: '2026-03-03T00:00:00.000Z',
      }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('inc-1')).toMatchObject({
      source_name: 'Updated',
      amount_usd: 400,
      earned_by: 'uid-b',
      updated_at: '2026-03-03T00:00:00.000Z',
    });
  });

  it('keeps the local row when the cloud snapshot has the same updatedAt', async () => {
    mockRows.set('inc-1', {
      id: 'inc-1',
      source_name: 'Local',
      amount_usd: 250,
      earned_by: 'uid-b',
      updated_at: '2026-03-02T12:00:00.000Z',
    });

    await upsertIncomeFromCloud(
      income({
        sourceName: 'Cloud',
        amountUsd: 1,
        earnedBy: 'uid-a',
        updatedAt: '2026-03-02T12:00:00.000Z',
      }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('inc-1')).toMatchObject({
      source_name: 'Local',
      amount_usd: 250,
      earned_by: 'uid-b',
    });
  });

  it('does not clobber a local row when the cloud snapshot omits updatedAt', async () => {
    mockRows.set('inc-1', {
      id: 'inc-1',
      source_name: 'Local',
      amount_usd: 250,
      earned_by: 'uid-b',
      updated_at: '2026-03-02T12:00:00.000Z',
    });

    await upsertIncomeFromCloud(
      income({ sourceName: 'Cloud', amountUsd: 1, updatedAt: undefined as unknown as string }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('inc-1')?.source_name).toBe('Local');
  });

  it('inserts a missing income stamped with the listener uid, household, and occurrence flag', async () => {
    await upsertIncomeFromCloud(
      income({
        sourceName: 'Payroll',
        amountUsd: 3200,
        earnedBy: 'uid-a',
        createdBy: 'uid-a',
        isRecurringOccurrence: true,
        recurring: { frequency: 'biweekly', nextDueDate: '2026-03-15', endDate: '2026-12-31' },
      }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('inc-1')).toMatchObject({
      source_name: 'Payroll',
      amount_usd: 3200,
      earned_by: 'uid-a',
      created_by: 'uid-a',
      user_id: 'user-1',
      household_id: 'house-1',
      is_recurring_occurrence: 1,
    });
    expect(JSON.parse(String(mockRows.get('inc-1')?.recurring_json))).toEqual({
      frequency: 'biweekly',
      nextDueDate: '2026-03-15',
      endDate: '2026-12-31',
    });
  });
});
