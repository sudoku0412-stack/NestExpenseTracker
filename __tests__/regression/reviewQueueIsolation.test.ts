/**
 * The review inbox joins review_queue to receipts. A missed uid or
 * household filter would show another household's scans (or another
 * user's) as "needs review", and clearReviewQueue would mark them
 * reviewed on the wrong partition.
 */

type ReceiptRow = {
  id: string;
  store_name: string;
  date: string;
  total_amount: number;
  subtotal_amount: number | null;
  tax_amount: number | null;
  category: string;
  category_tags: string | null;
  raw_text: string | null;
  image_uri: string | null;
  photo_url: string | null;
  notes: string | null;
  split_json: string | null;
  recurring_json: string | null;
  original_currency: string | null;
  fx_rate: number | null;
  paid_by: string | null;
  created_by: string | null;
  is_recurring_occurrence: number | null;
  household_id: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
};

const mockReceipts = new Map<string, ReceiptRow>();
const mockQueue = new Set<string>();
const mockPhotoUpdates: { sql: string; params: unknown[] }[] = [];

function mockHidMode(sql: string): 'none' | 'loose' | 'strict' {
  if (/household_id IS NULL/i.test(sql)) return 'loose';
  if (/household_id\s*=\s*\?/i.test(sql)) return 'strict';
  return 'none';
}

function mockMatchesHid(row: ReceiptRow, sql: string, params: unknown[]): boolean {
  const mode = mockHidMode(sql);
  if (mode === 'none') return true;
  const hid = params[params.length - 1] as string | null | undefined;
  if (mode === 'strict') return row.household_id === hid;
  return row.household_id === null || row.household_id === hid;
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getAllAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/FROM line_items/i.test(sql)) return [];
      if (!/FROM receipts/i.test(sql)) return [];
      const uid = params[0] as string;
      return [...mockReceipts.values()]
        .filter((r) => r.user_id === uid)
        .filter((r) => (sql.includes('review_queue') ? mockQueue.has(r.id) : true))
        .filter((r) => mockMatchesHid(r, sql, params))
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/COUNT\(\*\)/i.test(sql)) {
        const uid = params[0] as string;
        const n = [...mockReceipts.values()].filter(
          (r) =>
            r.user_id === uid &&
            mockQueue.has(r.id) &&
            mockMatchesHid(r, sql, params),
        ).length;
        return { n };
      }
      return null;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT OR IGNORE INTO review_queue/i.test(sql)) {
        mockQueue.add(params[0] as string);
      } else if (/DELETE FROM review_queue WHERE receipt_id IN/i.test(sql)) {
        const uid = params[0] as string;
        for (const r of mockReceipts.values()) {
          if (r.user_id === uid && mockMatchesHid(r, sql, params)) mockQueue.delete(r.id);
        }
      } else if (/DELETE FROM review_queue WHERE receipt_id=\?/i.test(sql)) {
        mockQueue.delete(params[0] as string);
      } else if (/UPDATE receipts SET photo_url/i.test(sql)) {
        mockPhotoUpdates.push({ sql, params });
        const photoUrl = params[0] as string;
        const id = params[1] as string;
        const uid = params[2] as string;
        const hid = params[3] as string | null;
        const row = mockReceipts.get(id);
        if (!row || row.user_id !== uid) return { lastInsertRowId: 0, changes: 0 };
        const matchNull = row.household_id === null;
        const matchHid = hid != null && row.household_id === hid;
        const hidUnset = hid == null;
        if (matchNull || matchHid || hidUnset) row.photo_url = photoUrl;
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
  addToReviewQueue,
  clearReviewQueue,
  getReviewQueueCount,
  getReviewQueueReceipts,
  setCurrentHouseholdId,
  setCurrentUserId,
  setReceiptPhotoUrl,
} from '../../lib/database';

function seed(overrides: Partial<ReceiptRow> & { id: string }): ReceiptRow {
  const row: ReceiptRow = {
    store_name: 'Costco',
    date: '2026-03-01',
    total_amount: 10,
    subtotal_amount: null,
    tax_amount: null,
    category: 'Groceries',
    category_tags: null,
    raw_text: null,
    image_uri: null,
    photo_url: null,
    notes: null,
    split_json: null,
    recurring_json: null,
    original_currency: null,
    fx_rate: null,
    paid_by: null,
    created_by: null,
    is_recurring_occurrence: 0,
    household_id: 'hh1',
    created_at: '2026-03-01T00:00:00.000Z',
    updated_at: '2026-03-01T00:00:00.000Z',
    user_id: 'u1',
    ...overrides,
  };
  mockReceipts.set(row.id, row);
  mockQueue.add(row.id);
  return row;
}

beforeEach(async () => {
  mockReceipts.clear();
  mockQueue.clear();
  mockPhotoUpdates.length = 0;
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('u1');
});

describe('review queue household isolation', () => {
  it('hides other-household and other-uid queued receipts while including NULL-hid backfill', async () => {
    seed({ id: 'mine', date: '2026-03-03' });
    seed({ id: 'backfill', household_id: null, date: '2026-03-02' });
    seed({ id: 'other-hh', household_id: 'hh2', date: '2026-03-04' });
    seed({ id: 'other-user', user_id: 'u2', date: '2026-03-05' });

    const listed = (await getReviewQueueReceipts()).map((r) => r.id);
    expect(listed).toEqual(['mine', 'backfill']);
    expect(await getReviewQueueCount()).toBe(2);
  });

  it('clearReviewQueue only drops this user\'s active-household (and NULL-hid) queue rows', async () => {
    seed({ id: 'mine' });
    seed({ id: 'backfill', household_id: null });
    seed({ id: 'other-hh', household_id: 'hh2' });
    seed({ id: 'other-user', user_id: 'u2' });

    await clearReviewQueue();
    expect(mockQueue.has('mine')).toBe(false);
    expect(mockQueue.has('backfill')).toBe(false);
    expect(mockQueue.has('other-hh')).toBe(true);
    expect(mockQueue.has('other-user')).toBe(true);
  });

  it('unsigned list/count/add throw and write nothing', async () => {
    await setCurrentUserId(null);
    await expect(getReviewQueueReceipts()).rejects.toThrow(/No authenticated user/);
    await expect(getReviewQueueCount()).rejects.toThrow(/No authenticated user/);
    await expect(addToReviewQueue('r1')).rejects.toThrow(/No authenticated user/);
    expect(mockQueue.size).toBe(0);
  });
});

describe('setReceiptPhotoUrl isolation', () => {
  it('does not stamp a photo onto another household\'s receipt while a household is active', async () => {
    seed({ id: 'mine', photo_url: null });
    seed({ id: 'other-hh', household_id: 'hh2', photo_url: null });
    seed({ id: 'other-user', user_id: 'u2', photo_url: null });

    await setReceiptPhotoUrl('mine', 'https://cdn.example/a.jpg');
    await setReceiptPhotoUrl('other-hh', 'https://cdn.example/leak.jpg');
    await setReceiptPhotoUrl('other-user', 'https://cdn.example/leak.jpg');

    expect(mockReceipts.get('mine')!.photo_url).toBe('https://cdn.example/a.jpg');
    expect(mockReceipts.get('other-hh')!.photo_url).toBeNull();
    expect(mockReceipts.get('other-user')!.photo_url).toBeNull();
  });
});
