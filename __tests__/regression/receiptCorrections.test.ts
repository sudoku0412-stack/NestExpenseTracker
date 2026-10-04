/**
 * Scan learns from user edits via receipt_corrections. Those rows
 * feed Gemini prompts, so a missed user_id filter or a store-name
 * mismatch would leak another user's line items into OCR, and an
 * unbounded insert would grow the local DB without bound.
 */

type CorrectionRow = {
  id: string;
  store_name: string;
  raw_ocr: string;
  items_json: string;
  created_at: string;
  user_id: string;
};

const mockCorrections: CorrectionRow[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (!/FROM receipt_corrections/i.test(sql)) return [];
      const store = params[0] as string;
      const uid = params[1] as string;
      const limit = typeof params[2] === 'number' ? params[2] : 2;
      return mockCorrections
        .filter((r) => r.store_name === store && r.user_id === uid)
        .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
        .slice(0, limit);
    }),
    getFirstAsync: jest.fn(async () => null),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO receipt_corrections/i.test(sql)) {
        mockCorrections.push({
          id: params[0] as string,
          store_name: params[1] as string,
          raw_ocr: params[2] as string,
          items_json: params[3] as string,
          created_at: params[4] as string,
          user_id: params[5] as string,
        });
      } else if (/DELETE FROM receipt_corrections/i.test(sql)) {
        const store = params[0] as string;
        const uid = params[1] as string;
        const keep = mockCorrections
          .filter((r) => r.store_name === store && r.user_id === uid)
          .sort((a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0))
          .slice(0, 10)
          .map((r) => r.id);
        const keepSet = new Set(keep);
        for (let i = mockCorrections.length - 1; i >= 0; i--) {
          const r = mockCorrections[i];
          if (r.store_name === store && r.user_id === uid && !keepSet.has(r.id)) {
            mockCorrections.splice(i, 1);
          }
        }
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
  getRelevantCorrections,
  saveCorrection,
  setCurrentUserId,
} from '../../lib/database';

function seed(overrides: Partial<CorrectionRow>): CorrectionRow {
  const row: CorrectionRow = {
    id: `c-${mockCorrections.length}`,
    store_name: 'costco',
    raw_ocr: 'MILK 4.00',
    items_json: JSON.stringify([{ name: 'Milk', amount: 4, category: 'Groceries' }]),
    created_at: '2026-03-01T00:00:00.000Z',
    user_id: 'u1',
    ...overrides,
  };
  mockCorrections.push(row);
  return row;
}

beforeEach(async () => {
  mockCorrections.length = 0;
  await setCurrentUserId('u1');
});

describe('saveCorrection', () => {
  it('throws when unsigned', async () => {
    await setCurrentUserId(null);
    await expect(
      saveCorrection({
        storeName: 'Costco',
        rawOcr: 'x',
        items: [{ id: 'i1', name: 'Milk', amount: 4 }],
      }),
    ).rejects.toThrow(/No authenticated user/);
  });

  it('no-ops on a blank store name so we never write an empty key', async () => {
    await saveCorrection({
      storeName: '   ',
      rawOcr: 'MILK',
      items: [{ id: 'i1', name: 'Milk', amount: 4 }],
    });
    expect(mockCorrections).toHaveLength(0);
  });

  it('normalizes the store key, truncates OCR, and stores a compact items payload', async () => {
    await saveCorrection({
      storeName: '  Costco  ',
      rawOcr: 'x'.repeat(4000),
      items: [{ id: 'i1', name: 'Milk', amount: 4.5, category: 'Groceries' }],
    });
    expect(mockCorrections).toHaveLength(1);
    expect(mockCorrections[0].store_name).toBe('costco');
    expect(mockCorrections[0].user_id).toBe('u1');
    expect(mockCorrections[0].raw_ocr).toHaveLength(3000);
    expect(JSON.parse(mockCorrections[0].items_json)).toEqual([
      { name: 'Milk', amount: 4.5, category: 'Groceries' },
    ]);
  });

  it('keeps only the 10 newest corrections per store for this user', async () => {
    for (let i = 0; i < 10; i++) {
      seed({
        id: `old-${i}`,
        created_at: `2026-01-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`,
      });
    }
    seed({
      id: 'other-store',
      store_name: 'walmart',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    seed({
      id: 'other-user',
      user_id: 'u2',
      created_at: '2026-01-01T00:00:00.000Z',
    });

    await saveCorrection({
      storeName: 'Costco',
      rawOcr: 'NEW',
      items: [{ id: 'n', name: 'Eggs', amount: 3 }],
    });

    const mine = mockCorrections.filter((r) => r.store_name === 'costco' && r.user_id === 'u1');
    expect(mine).toHaveLength(10);
    expect(mine.some((r) => r.raw_ocr === 'NEW')).toBe(true);
    expect(mine.some((r) => r.id === 'old-0')).toBe(false);
    expect(mockCorrections.some((r) => r.id === 'other-store')).toBe(true);
    expect(mockCorrections.some((r) => r.id === 'other-user')).toBe(true);
  });
});

describe('getRelevantCorrections', () => {
  it('throws when unsigned', async () => {
    await setCurrentUserId(null);
    await expect(getRelevantCorrections('Costco')).rejects.toThrow(/No authenticated user/);
  });

  it('returns [] for a blank store', async () => {
    seed({});
    await expect(getRelevantCorrections('   ')).resolves.toEqual([]);
  });

  it('returns only this user\'s newest rows for the store, newest first', async () => {
    seed({
      id: 'theirs',
      user_id: 'u2',
      created_at: '2026-03-10T00:00:00.000Z',
      items_json: JSON.stringify([{ name: 'Leak', amount: 99 }]),
    });
    seed({
      id: 'walmart',
      store_name: 'walmart',
      created_at: '2026-03-10T00:00:00.000Z',
    });
    seed({
      id: 'old',
      created_at: '2026-03-01T00:00:00.000Z',
      items_json: JSON.stringify([{ name: 'Old', amount: 1 }]),
    });
    seed({
      id: 'new',
      created_at: '2026-03-07T00:00:00.000Z',
      raw_ocr: 'EGGS 2.00',
      items_json: JSON.stringify([{ name: 'New', amount: 2, category: 'Groceries' }]),
    });

    const rows = await getRelevantCorrections('  COSTCO ', 2);
    expect(rows).toHaveLength(2);
    expect(rows[0].items).toEqual([{ name: 'New', amount: 2, category: 'Groceries' }]);
    expect(rows[0].rawOcr).toBe('EGGS 2.00');
    expect(rows[1].items).toEqual([{ name: 'Old', amount: 1 }]);
  });

  it('skips malformed items_json in the LIMIT window and does not backfill older rows', async () => {
    seed({
      id: 'bad',
      items_json: '{not-json',
      created_at: '2026-03-09T00:00:00.000Z',
    });
    seed({
      id: 'not-array',
      items_json: '{"name":"x"}',
      created_at: '2026-03-08T00:00:00.000Z',
    });
    seed({
      id: 'valid-but-older',
      created_at: '2026-03-01T00:00:00.000Z',
      items_json: JSON.stringify([{ name: 'Old', amount: 1 }]),
    });

    await expect(getRelevantCorrections('costco', 2)).resolves.toEqual([]);
  });
});
