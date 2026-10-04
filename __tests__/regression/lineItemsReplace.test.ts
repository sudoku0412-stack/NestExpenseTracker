/**
 * Line-item edits from the receipt-detail modal go through
 * replaceLineItems / updateLineItemCategory — not updateReceipt.
 * Budgets now attribute spend from those item categories, so a missed
 * ownership check or a skipped cloud shadow-write would desync
 * household members and fire the wrong alerts.
 */

type ReceiptRow = {
  id: string;
  user_id: string;
  household_id: string | null;
  updated_at: string;
};

type LineItemRow = {
  id: string;
  receipt_id: string;
  name: string;
  amount: number;
  category: string | null;
  split_with: string | null;
};

type GeminiRow = { response_json: string; created_at: string };

const mockReceipts = new Map<string, ReceiptRow>();
const mockLineItems: LineItemRow[] = [];
const mockGemini = new Map<string, GeminiRow>();
const mockClassifications = new Map<string, { category: string; source: string }>();

function mockHidFilter(sql: string, row: ReceiptRow, params: unknown[]): boolean {
  if (!/household_id/i.test(sql)) return true;
  const hid = params[params.length - 1] as string;
  if (/household_id IS NULL/i.test(sql)) return row.household_id === null || row.household_id === hid;
  return row.household_id === hid;
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM line_items/i.test(sql)) {
        const ids = new Set(params);
        return mockLineItems.filter((r) => ids.has(r.receipt_id));
      }
      return [];
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM gemini_cache/i.test(sql)) {
        return mockGemini.get(params[0] as string) ?? null;
      }
      if (/FROM item_classifications/i.test(sql)) {
        return mockClassifications.get(params[0] as string) ?? null;
      }
      if (/FROM receipts/i.test(sql)) {
        const row = mockReceipts.get(params[0] as string);
        if (!row) return null;
        if (params[1] && row.user_id !== params[1]) return null;
        if (!mockHidFilter(sql, row, params)) return null;
        return row;
      }
      return null;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO gemini_cache/i.test(sql)) {
        mockGemini.set(params[0] as string, {
          response_json: params[1] as string,
          created_at: params[2] as string,
        });
      } else if (/INSERT INTO item_classifications/i.test(sql)) {
        mockClassifications.set(params[0] as string, {
          category: params[1] as string,
          source: params[2] as string,
        });
      } else if (/UPDATE line_items\s+SET category/i.test(sql)) {
        const category = params[0] as string;
        const itemId = params[1] as string;
        const uid = params[2] as string;
        const owned = new Set(
          [...mockReceipts.values()].filter((r) => r.user_id === uid).map((r) => r.id),
        );
        const item = mockLineItems.find((r) => r.id === itemId);
        if (item && owned.has(item.receipt_id)) item.category = category;
      } else if (/DELETE FROM line_items WHERE receipt_id/i.test(sql)) {
        const receiptId = params[0] as string;
        for (let i = mockLineItems.length - 1; i >= 0; i--) {
          if (mockLineItems[i].receipt_id === receiptId) mockLineItems.splice(i, 1);
        }
      } else if (/INSERT INTO line_items/i.test(sql)) {
        mockLineItems.push({
          id: params[0] as string,
          receipt_id: params[1] as string,
          name: params[2] as string,
          amount: params[3] as number,
          category: (params[4] as string | null) ?? null,
          split_with: (params[5] as string | null) ?? null,
        });
      } else if (/UPDATE receipts SET updated_at/i.test(sql)) {
        const row = mockReceipts.get(params[1] as string);
        if (row && row.user_id === params[2]) row.updated_at = params[0] as string;
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
  getCachedItemClassification,
  getGeminiCachedResponse,
  getReceiptById,
  hashOcrText,
  replaceLineItems,
  setCachedItemClassification,
  setCurrentHouseholdId,
  setCurrentUserId,
  setGeminiCachedResponse,
  updateLineItemCategory,
} from '../../lib/database';
import { syncReceiptToCloud } from '../../lib/cloudSync';

const mockSync = syncReceiptToCloud as jest.Mock;

function seedReceipt(overrides: Partial<ReceiptRow> = {}): ReceiptRow {
  const row: ReceiptRow = {
    id: 'r1',
    user_id: 'u1',
    household_id: 'hh1',
    updated_at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
  mockReceipts.set(row.id, row);
  return row;
}

beforeEach(async () => {
  mockReceipts.clear();
  mockLineItems.length = 0;
  mockGemini.clear();
  mockClassifications.clear();
  mockSync.mockClear();
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('u1');
});

describe('replaceLineItems', () => {
  it('replaces items, bumps updated_at, and shadow-writes the full receipt', async () => {
    seedReceipt();
    mockLineItems.push({
      id: 'old',
      receipt_id: 'r1',
      name: 'Milk',
      amount: 4,
      category: 'Groceries',
      split_with: null,
    });

    await replaceLineItems('r1', [
      { id: 'new', name: 'Kibble', amount: 12, category: 'Pets' },
    ]);

    expect(mockLineItems.map((r) => r.id)).toEqual(['new']);
    expect(mockLineItems[0]).toMatchObject({ name: 'Kibble', category: 'Pets', amount: 12 });
    expect(mockReceipts.get('r1')!.updated_at).not.toBe('2026-03-01T00:00:00.000Z');
    expect(mockSync).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1' }), 'hh1');
  });

  it('does nothing for another user\'s receipt or a missing id', async () => {
    seedReceipt({ user_id: 'u2' });
    mockLineItems.push({
      id: 'keep',
      receipt_id: 'r1',
      name: 'Milk',
      amount: 4,
      category: 'Groceries',
      split_with: null,
    });
    await replaceLineItems('r1', [{ id: 'x', name: 'X', amount: 1, category: 'Gas' }]);
    expect(mockLineItems.map((r) => r.id)).toEqual(['keep']);
    expect(mockSync).not.toHaveBeenCalled();

    await replaceLineItems('missing', [{ id: 'x', name: 'X', amount: 1 }]);
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('does not touch a receipt from another household', async () => {
    seedReceipt({ household_id: 'hh-other' });
    mockLineItems.push({
      id: 'keep',
      receipt_id: 'r1',
      name: 'Milk',
      amount: 4,
      category: 'Groceries',
      split_with: null,
    });
    await replaceLineItems('r1', [{ id: 'x', name: 'X', amount: 1, category: 'Pets' }]);
    expect(mockLineItems[0].id).toBe('keep');
  });

  it('skips the cloud write when the receipt has no household', async () => {
    seedReceipt({ household_id: null });
    setCurrentHouseholdId(null);
    await replaceLineItems('r1', [{ id: 'n', name: 'X', amount: 2, category: 'Other' }]);
    expect(mockLineItems).toHaveLength(1);
    expect(mockSync).not.toHaveBeenCalled();
  });
});

describe('updateLineItemCategory', () => {
  it('updates only items on the signed-in user\'s receipts', async () => {
    seedReceipt();
    seedReceipt({ id: 'r2', user_id: 'u2' });
    mockLineItems.push(
      { id: 'mine', receipt_id: 'r1', name: 'A', amount: 1, category: 'Groceries', split_with: null },
      { id: 'theirs', receipt_id: 'r2', name: 'B', amount: 1, category: 'Groceries', split_with: null },
    );
    await updateLineItemCategory('mine', 'Pets');
    await updateLineItemCategory('theirs', 'Pets');
    expect(mockLineItems.find((r) => r.id === 'mine')!.category).toBe('Pets');
    expect(mockLineItems.find((r) => r.id === 'theirs')!.category).toBe('Groceries');
  });
});

describe('hashOcrText / gemini cache', () => {
  it('normalizes case and whitespace so the same receipt hits one key', () => {
    expect(hashOcrText('  COSTCO   Milk  ')).toBe(hashOcrText('costco milk'));
    expect(hashOcrText('costco milk')).not.toBe(hashOcrText('costco bread'));
  });

  it('returns a cached parse until it expires', async () => {
    await setGeminiCachedResponse('costco milk', '{"store":"Costco"}');
    expect(await getGeminiCachedResponse('COSTCO   milk')).toBe('{"store":"Costco"}');
    const row = [...mockGemini.values()][0];
    row.created_at = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(await getGeminiCachedResponse('costco milk')).toBeNull();
  });
});

describe('item classification cache', () => {
  it('round-trips a cleaned name', async () => {
    expect(await getCachedItemClassification('kibble')).toBeNull();
    await setCachedItemClassification('kibble', 'Pets', 'remote');
    expect(await getCachedItemClassification('kibble')).toEqual({
      category: 'Pets',
      source: 'remote',
    });
  });
});
