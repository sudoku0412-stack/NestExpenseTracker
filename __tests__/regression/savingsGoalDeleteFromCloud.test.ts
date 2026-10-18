/**
 * A remote savings-goal delete must stay uid + household scoped. A stale
 * listener for another household, or another uid on a shared device, must
 * not wipe a local envelope.
 */

type GoalRow = {
  id: string;
  user_id: string;
  household_id: string;
  name: string;
};

const mockRows: GoalRow[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    runAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (/DELETE FROM savings_goals WHERE id=\? AND user_id=\? AND household_id=\?/.test(sql)) {
        const [id, uid, hid] = params as [string, string, string];
        const keep = mockRows.filter(
          (r) => !(r.id === id && r.user_id === uid && r.household_id === hid),
        );
        mockRows.length = 0;
        mockRows.push(...keep);
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

import { deleteSavingsGoalFromCloud } from '../../lib/database';

function seed(overrides: Partial<GoalRow>): GoalRow {
  const row: GoalRow = {
    id: 'g1',
    user_id: 'u1',
    household_id: 'hh1',
    name: 'Emergency',
    ...overrides,
  };
  mockRows.push(row);
  return row;
}

describe('deleteSavingsGoalFromCloud', () => {
  beforeEach(() => {
    mockRows.length = 0;
  });

  it('deletes only the matching uid + household row', async () => {
    seed({ id: 'g1', user_id: 'u1', household_id: 'hh1', name: 'Mine' });
    seed({ id: 'g1', user_id: 'u2', household_id: 'hh1', name: 'Other user' });
    seed({ id: 'g1', user_id: 'u1', household_id: 'hh2', name: 'Other house' });
    seed({ id: 'g2', user_id: 'u1', household_id: 'hh1', name: 'Other goal' });

    await deleteSavingsGoalFromCloud('g1', 'u1', 'hh1');

    expect(mockRows.map((r) => r.name).sort()).toEqual(['Other goal', 'Other house', 'Other user']);
  });

  it('is a no-op when the id exists only under another household', async () => {
    seed({ id: 'g1', user_id: 'u1', household_id: 'hh2', name: 'Keep' });
    await deleteSavingsGoalFromCloud('g1', 'u1', 'hh1');
    expect(mockRows).toHaveLength(1);
    expect(mockRows[0].name).toBe('Keep');
  });
});
