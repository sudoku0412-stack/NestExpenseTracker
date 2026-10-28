/**
 * A stale Firestore snapshot must not overwrite a newer local envelope.
 */

type GoalRow = Record<string, string | number | null>;

const mockRows = new Map<string, GoalRow>();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async (_sql: string, params: string[]) => mockRows.get(params[0]) ?? null),
    runAsync: jest.fn(async (_sql: string, params: unknown[]) => {
      const id = params[0] as string;
      mockRows.set(id, {
        id,
        name: params[1] as string,
        target_usd: params[2] as number,
        allocated_usd: params[3] as number,
        notes: params[4] as string | null,
        updated_at: params[6] as string,
        user_id: params[7] as string,
        household_id: params[8] as string | null,
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

import { upsertSavingsGoalFromCloud } from '../../lib/database';
import { SavingsGoal } from '../../types';

function goal(overrides: Partial<SavingsGoal>): SavingsGoal {
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

describe('upsertSavingsGoalFromCloud', () => {
  beforeEach(() => {
    mockRows.clear();
  });

  it('keeps a newer local envelope when the cloud snapshot is older', async () => {
    mockRows.set('g1', {
      id: 'g1',
      name: 'Vacation',
      target_usd: 2000,
      allocated_usd: 500,
      updated_at: '2026-03-02T12:00:00.000Z',
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
      updated_at: '2026-03-01T00:00:00.000Z',
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
    });
  });

  it('keeps the local envelope when updatedAt is equal or missing on the cloud snapshot', async () => {
    mockRows.set('g1', {
      id: 'g1',
      name: 'Vacation',
      target_usd: 2000,
      allocated_usd: 500,
      updated_at: '2026-03-02T12:00:00.000Z',
    });

    await upsertSavingsGoalFromCloud(
      goal({ name: 'Cloud', allocatedUsd: 1, updatedAt: '2026-03-02T12:00:00.000Z' }),
      'user-1',
      'house-1',
    );
    expect(mockRows.get('g1')?.name).toBe('Vacation');

    await upsertSavingsGoalFromCloud(
      goal({ name: 'Cloud', allocatedUsd: 1, updatedAt: undefined as unknown as string }),
      'user-1',
      'house-1',
    );
    expect(mockRows.get('g1')?.allocated_usd).toBe(500);
  });

  it('inserts a missing envelope stamped with the listener uid and household', async () => {
    await upsertSavingsGoalFromCloud(
      goal({ name: 'Emergency', notes: 'keep 3 months' }),
      'user-1',
      'house-1',
    );

    expect(mockRows.get('g1')).toMatchObject({
      name: 'Emergency',
      target_usd: 1000,
      allocated_usd: 100,
      notes: 'keep 3 months',
      user_id: 'user-1',
      household_id: 'house-1',
    });
  });
});
