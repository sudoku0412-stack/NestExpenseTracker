/**
 * History / edit / review all call deleteReceipt. The local DELETE is
 * the only uid+household guard; review_queue is keyed by receipt_id
 * alone, so wiping it after a 0-row delete would drop another user's
 * queued item. Cloud shadow-write must not fire in local-only mode.
 */

type ReceiptRow = {
  id: string;
  user_id: string;
  household_id: string | null;
};

const mockReceipts = new Map<string, ReceiptRow>();
const mockReviewQueue = new Set<string>();

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    getAllAsync: jest.fn(async () => []),
    getFirstAsync: jest.fn(async () => null),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/DELETE FROM receipts WHERE id=\? AND user_id=\?/i.test(sql)) {
        const id = params[0] as string;
        const uid = params[1] as string;
        const hid = (params[2] as string | null) ?? null;
        const row = mockReceipts.get(id);
        const hidOk =
          hid == null || row?.household_id == null || row.household_id === hid;
        if (row && row.user_id === uid && hidOk) {
          mockReceipts.delete(id);
          return { lastInsertRowId: 0, changes: 1 };
        }
        return { lastInsertRowId: 0, changes: 0 };
      }
      if (/DELETE FROM review_queue WHERE receipt_id=\?/i.test(sql)) {
        mockReviewQueue.delete(params[0] as string);
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

import { deleteReceipt, setCurrentHouseholdId, setCurrentUserId } from '../../lib/database';
import { syncReceiptDeletionToCloud } from '../../lib/cloudSync';

const mockSyncDeletion = syncReceiptDeletionToCloud as jest.Mock;

function seed(overrides: Partial<ReceiptRow> = {}): ReceiptRow {
  const row: ReceiptRow = {
    id: 'r1',
    user_id: 'u1',
    household_id: 'hh1',
    ...overrides,
  };
  mockReceipts.set(row.id, row);
  return row;
}

beforeEach(async () => {
  mockReceipts.clear();
  mockReviewQueue.clear();
  mockSyncDeletion.mockClear();
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('u1');
});

describe('deleteReceipt', () => {
  it('throws when no user is signed in', async () => {
    await setCurrentUserId(null);
    await expect(deleteReceipt('r1')).rejects.toThrow(/No authenticated user/);
  });

  it('deletes the signed-in user row, drops its review queue entry, and shadows to cloud', async () => {
    seed();
    mockReviewQueue.add('r1');
    await deleteReceipt('r1');
    expect(mockReceipts.has('r1')).toBe(false);
    expect(mockReviewQueue.has('r1')).toBe(false);
    expect(mockSyncDeletion).toHaveBeenCalledWith('r1', 'hh1');
  });

  it('does not delete another user\'s receipt or clear a review_queue row for a 0-change delete', async () => {
    seed({ user_id: 'u2' });
    mockReviewQueue.add('r1');
    await deleteReceipt('r1');
    expect(mockReceipts.has('r1')).toBe(true);
    expect(mockReviewQueue.has('r1')).toBe(true);
  });

  it('does not delete a receipt from another household', async () => {
    seed({ household_id: 'hh-other' });
    await deleteReceipt('r1');
    expect(mockReceipts.has('r1')).toBe(true);
  });

  it('still deletes a legacy NULL-household row while a household is active', async () => {
    seed({ household_id: null });
    await deleteReceipt('r1');
    expect(mockReceipts.has('r1')).toBe(false);
  });

  it('skips the cloud shadow-write when there is no active household', async () => {
    seed({ household_id: null });
    setCurrentHouseholdId(null);
    await deleteReceipt('r1');
    expect(mockReceipts.has('r1')).toBe(false);
    expect(mockSyncDeletion).not.toHaveBeenCalled();
  });
});
