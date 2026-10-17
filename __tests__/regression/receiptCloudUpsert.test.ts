/**
 * Receipts already have income/goal tests for "stale Firestore snapshot
 * must not clobber a newer local row." The original split-reset bug was
 * on receipts: syncReceiptToCloud is fire-and-forget, so a rebuild or
 * crash before that write lands delivers the OLD doc on next snapshot.
 * upsertReceiptFromCloud's updated_at guard is the only thing that
 * keeps a just-saved split from vanishing. That path had no tests.
 *
 * Also pins household isolation (householdFilterSql vs the strict
 * getAllReceiptsForHousehold delete-check) and deleteReceiptLocally's
 * uid+household scope — a malformed listener payload must not wipe
 * another household's local row.
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
  fx_rate?: number | null;
  paid_by: string | null;
  created_by: string | null;
  is_recurring_occurrence: number | null;
  household_id: string | null;
  created_at: string;
  updated_at: string;
  user_id: string;
};

type LineItemRow = {
  id: string;
  receipt_id: string;
  name: string;
  amount: number;
  category: string | null;
  split_with: string | null;
};

const mockReceipts = new Map<string, ReceiptRow>();
const mockLineItems: LineItemRow[] = [];

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

function mockRowFromSaveParams(params: unknown[]): ReceiptRow {
  return {
    id: params[0] as string,
    store_name: params[1] as string,
    date: params[2] as string,
    total_amount: params[3] as number,
    subtotal_amount: (params[4] as number | null) ?? null,
    tax_amount: (params[5] as number | null) ?? null,
    category: params[6] as string,
    category_tags: (params[7] as string | null) ?? null,
    raw_text: (params[8] as string | null) ?? null,
    image_uri: (params[9] as string | null) ?? null,
    photo_url: (params[10] as string | null) ?? null,
    notes: (params[11] as string | null) ?? null,
    split_json: (params[12] as string | null) ?? null,
    recurring_json: (params[13] as string | null) ?? null,
    original_currency: (params[14] as string | null) ?? null,
    paid_by: (params[15] as string | null) ?? null,
    created_by: (params[16] as string | null) ?? null,
    is_recurring_occurrence: (params[17] as number | null) ?? 0,
    created_at: params[18] as string,
    updated_at: params[19] as string,
    user_id: params[20] as string,
    household_id: (params[21] as string | null) ?? null,
    fx_rate: (params[22] as number | null) ?? null,
  };
}

function mockRowFromCloudParams(params: unknown[]): ReceiptRow {
  return {
    id: params[0] as string,
    store_name: params[1] as string,
    date: params[2] as string,
    total_amount: params[3] as number,
    subtotal_amount: (params[4] as number | null) ?? null,
    tax_amount: (params[5] as number | null) ?? null,
    category: params[6] as string,
    category_tags: (params[7] as string | null) ?? null,
    raw_text: (params[8] as string | null) ?? null,
    image_uri: (params[9] as string | null) ?? null,
    photo_url: (params[10] as string | null) ?? null,
    notes: (params[11] as string | null) ?? null,
    split_json: (params[12] as string | null) ?? null,
    recurring_json: (params[13] as string | null) ?? null,
    original_currency: null,
    paid_by: (params[14] as string | null) ?? null,
    created_by: (params[15] as string | null) ?? null,
    is_recurring_occurrence: (params[16] as number | null) ?? 0,
    created_at: params[17] as string,
    updated_at: params[18] as string,
    user_id: params[19] as string,
    household_id: (params[20] as string | null) ?? null,
  };
}

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    withTransactionAsync: jest.fn(async (fn: () => Promise<void>) => fn()),
    getAllAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('FROM line_items')) {
        const ids = new Set(params);
        return mockLineItems.filter((r) => ids.has(r.receipt_id));
      }
      if (!sql.includes('FROM receipts')) return [];
      const uid = (/WHERE id=\?/i.test(sql) ? params[1] : params[0]) as string;
      const { isInCalendarMonth } = require('../../lib/calendarDate');
      return [...mockReceipts.values()]
        .filter((r) => r.user_id === uid && mockMatchesHid(r, sql, params))
        .filter((r) => {
          if (!sql.includes('length(')) return true;
          const start = params[1] as string; // YYYY-MM-DD from calendarMonthSqlParams
          const [year, month] = start.split('-').map(Number);
          return isInCalendarMonth(r.date, year, month);
        })
        .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
    }),
    getFirstAsync: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('SELECT updated_at FROM receipts')) {
        const row = mockReceipts.get(params[0] as string);
        return row ? { updated_at: row.updated_at } : null;
      }
      if (!sql.includes('FROM receipts')) return null;
      const id = params[0] as string;
      const uid = params[1] as string | undefined;
      const row = mockReceipts.get(id);
      if (!row) return null;
      if (uid && row.user_id !== uid) return null;
      if (uid && !mockMatchesHid(row, sql, params)) return null;
      return row;
    }),
    runAsync: jest.fn(async (sql: string, params: unknown[] = []) => {
      if (/INSERT INTO receipts/i.test(sql) && /ON CONFLICT/i.test(sql)) {
        const incoming = mockRowFromCloudParams(params);
        const existing = mockReceipts.get(incoming.id);
        if (existing) {
          // Matches production ON CONFLICT: created_by, original_currency,
          // and fx_rate are local-only and must not be overwritten.
          mockReceipts.set(incoming.id, {
            ...incoming,
            created_by: existing.created_by,
            original_currency: existing.original_currency,
            fx_rate: existing.fx_rate,
          });
        } else {
          mockReceipts.set(incoming.id, incoming);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/INSERT INTO receipts/i.test(sql)) {
        const row = mockRowFromSaveParams(params);
        mockReceipts.set(row.id, row);
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/UPDATE receipts\s+SET store_name/i.test(sql)) {
        const id = params[14] as string;
        const uid = params[15] as string;
        const existing = mockReceipts.get(id);
        if (existing && existing.user_id === uid && mockMatchesHid(existing, sql, params)) {
          mockReceipts.set(id, {
            ...existing,
            store_name: params[0] as string,
            date: params[1] as string,
            total_amount: params[2] as number,
            subtotal_amount: (params[3] as number | null) ?? null,
            tax_amount: (params[4] as number | null) ?? null,
            category: params[5] as string,
            category_tags: (params[6] as string | null) ?? null,
            notes: (params[7] as string | null) ?? null,
            split_json: (params[8] as string | null) ?? null,
            recurring_json: (params[9] as string | null) ?? null,
            original_currency: (params[10] as string | null) ?? null,
            fx_rate: (params[11] as number | null) ?? null,
            paid_by: (params[12] as string | null) ?? null,
            updated_at: params[13] as string,
          });
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/DELETE FROM receipts/i.test(sql)) {
        const id = params[0] as string;
        const uid = params[1] as string;
        const hid = params[2] as string | undefined;
        const row = mockReceipts.get(id);
        if (row && row.user_id === uid && (hid === undefined || row.household_id === hid)) {
          mockReceipts.delete(id);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/DELETE FROM line_items/i.test(sql)) {
        const receiptId = params[0] as string;
        for (let i = mockLineItems.length - 1; i >= 0; i--) {
          if (mockLineItems[i].receipt_id === receiptId) mockLineItems.splice(i, 1);
        }
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/INSERT INTO line_items/i.test(sql)) {
        mockLineItems.push({
          id: params[0] as string,
          receipt_id: params[1] as string,
          name: params[2] as string,
          amount: params[3] as number,
          category: (params[4] as string | null) ?? null,
          split_with: (params[5] as string | null) ?? null,
        });
        return { lastInsertRowId: 0, changes: 1 };
      }
      if (/UPDATE receipts SET photo_url/i.test(sql)) {
        const photoUrl = params[0] as string;
        const id = params[1] as string;
        const uid = params[2] as string;
        const row = mockReceipts.get(id);
        if (row && row.user_id === uid && mockMatchesHid(row, sql, params)) {
          mockReceipts.set(id, { ...row, photo_url: photoUrl });
        }
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
  deleteReceiptLocally,
  getAllReceipts,
  getAllReceiptsForHousehold,
  getReceiptById,
  getReceiptsByMonth,
  saveReceipt,
  searchReceipts,
  setCurrentHouseholdId,
  setCurrentUserId,
  setReceiptPhotoUrl,
  updateReceipt,
  upsertReceiptFromCloud,
} from '../../lib/database';
import { syncReceiptToCloud } from '../../lib/cloudSync';
import { Receipt } from '../../types';

const mockSyncReceiptToCloud = syncReceiptToCloud as jest.Mock;

function seed(overrides: Partial<ReceiptRow>): ReceiptRow {
  const row: ReceiptRow = {
    id: 'r1',
    store_name: 'Costco',
    date: '2026-03-15',
    total_amount: 80,
    subtotal_amount: 72,
    tax_amount: 8,
    category: 'Groceries',
    category_tags: JSON.stringify(['Groceries']),
    raw_text: null,
    image_uri: null,
    photo_url: null,
    notes: null,
    split_json: null,
    recurring_json: null,
    original_currency: 'USD',
    paid_by: 'user-1',
    created_by: 'user-1',
    is_recurring_occurrence: 0,
    household_id: 'hh1',
    created_at: '2026-03-15T00:00:00.000Z',
    updated_at: '2026-03-15T00:00:00.000Z',
    user_id: 'user-1',
    ...overrides,
  };
  mockReceipts.set(row.id, row);
  return row;
}

function cloudReceipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    storeName: 'Costco',
    date: '2026-03-15',
    totalAmount: 80,
    category: 'Groceries',
    createdAt: '2026-03-15T00:00:00.000Z',
    updatedAt: '2026-03-15T00:00:00.000Z',
    createdBy: 'user-1',
    paidBy: 'user-1',
    ...overrides,
  };
}

beforeEach(async () => {
  mockReceipts.clear();
  mockLineItems.length = 0;
  mockSyncReceiptToCloud.mockClear();
  setCurrentHouseholdId('hh1');
  await setCurrentUserId('user-1');
});

describe('upsertReceiptFromCloud', () => {
  it('keeps a newer local split when the cloud snapshot is older', async () => {
    seed({
      split_json: JSON.stringify({
        enabled: true,
        method: 'equal',
        participantIds: ['self', 'roommate'],
      }),
      updated_at: '2026-03-16T12:00:00.000Z',
    });

    await upsertReceiptFromCloud(
      cloudReceipt({
        storeName: 'Old Costco',
        split: undefined,
        updatedAt: '2026-03-15T00:00:00.000Z',
      }),
      'user-1',
      'hh1',
    );

    const row = mockReceipts.get('r1')!;
    expect(row.store_name).toBe('Costco');
    expect(JSON.parse(row.split_json!)).toMatchObject({ enabled: true, method: 'equal' });
    expect(row.updated_at).toBe('2026-03-16T12:00:00.000Z');
  });

  it('skips an equally-fresh snapshot so a local save is not replaced by its own echo', async () => {
    seed({ store_name: 'Local', updated_at: '2026-03-16T12:00:00.000Z' });

    await upsertReceiptFromCloud(
      cloudReceipt({ storeName: 'Cloud echo', updatedAt: '2026-03-16T12:00:00.000Z' }),
      'user-1',
      'hh1',
    );

    expect(mockReceipts.get('r1')!.store_name).toBe('Local');
  });

  it('applies a newer snapshot and replaces line items, but does not drift created_by', async () => {
    seed({
      created_by: 'original-creator',
      updated_at: '2026-03-15T00:00:00.000Z',
    });
    mockLineItems.push({
      id: 'old-item',
      receipt_id: 'r1',
      name: 'Stale',
      amount: 1,
      category: 'Other',
      split_with: null,
    });

    await upsertReceiptFromCloud(
      cloudReceipt({
        storeName: 'Trader Joe\'s',
        createdBy: 'someone-else',
        updatedAt: '2026-03-17T00:00:00.000Z',
        lineItems: [{ id: 'new-item', name: 'Milk', amount: 4.5, category: 'Groceries' }],
      }),
      'user-1',
      'hh1',
    );

    expect(mockReceipts.get('r1')).toMatchObject({
      store_name: "Trader Joe's",
      created_by: 'original-creator',
      updated_at: '2026-03-17T00:00:00.000Z',
    });
    expect(mockLineItems.map((i) => i.name)).toEqual(['Milk']);
  });

  it('does not wipe a frozen fxRate or originalCurrency on a later cloud snapshot', async () => {
    seed({
      original_currency: 'EUR',
      fx_rate: 0.95,
      updated_at: '2026-03-15T00:00:00.000Z',
    });

    await upsertReceiptFromCloud(
      cloudReceipt({
        storeName: 'Paris Cafe',
        totalAmount: 90,
        updatedAt: '2026-03-18T00:00:00.000Z',
      }),
      'user-1',
      'hh1',
    );

    expect(mockReceipts.get('r1')).toMatchObject({
      store_name: 'Paris Cafe',
      total_amount: 90,
      original_currency: 'EUR',
      fx_rate: 0.95,
    });
  });
});

describe('deleteReceiptLocally', () => {
  it('does not delete a receipt from a different household or user', async () => {
    seed({ id: 'keep-hh', household_id: 'hh-other' });
    seed({ id: 'keep-user', user_id: 'user-2', household_id: 'hh1' });
    seed({ id: 'gone', household_id: 'hh1' });

    await deleteReceiptLocally('keep-hh', 'user-1', 'hh1');
    await deleteReceiptLocally('keep-user', 'user-1', 'hh1');
    await deleteReceiptLocally('gone', 'user-1', 'hh1');

    expect(mockReceipts.has('keep-hh')).toBe(true);
    expect(mockReceipts.has('keep-user')).toBe(true);
    expect(mockReceipts.has('gone')).toBe(false);
  });
});

describe('household isolation', () => {
  it('hides other-household receipts but still shows un-backfilled NULL household_id rows', async () => {
    seed({ id: 'mine', household_id: 'hh1', store_name: 'Mine' });
    seed({ id: 'legacy', household_id: null, store_name: 'Legacy' });
    seed({ id: 'theirs', household_id: 'hh-other', store_name: 'Theirs' });

    const all = await getAllReceipts();
    expect(all.map((r) => r.id).sort()).toEqual(['legacy', 'mine']);
    expect(await getReceiptById('theirs')).toBeNull();
    expect(await getReceiptById('legacy')).toMatchObject({ storeName: 'Legacy', householdId: undefined });
  });

  it('getAllReceiptsForHousehold uses strict household_id equality (no NULL leak)', async () => {
    seed({ id: 'mine', household_id: 'hh1' });
    seed({ id: 'legacy', household_id: null });
    seed({ id: 'other', household_id: 'hh-other' });

    const rows = await getAllReceiptsForHousehold('hh1');
    expect(rows.map((r) => r.id)).toEqual(['mine']);
  });

  it('searchReceipts stays inside the active household', async () => {
    seed({ id: 'mine', store_name: 'Costco HH1', household_id: 'hh1' });
    seed({ id: 'theirs', store_name: 'Costco other', household_id: 'hh-other' });

    const hits = await searchReceipts('costco');
    expect(hits.map((r) => r.id)).toEqual(['mine']);
  });

  it('getReceiptsByMonth stays in the civil month, household, and attaches line items', async () => {
    seed({ id: 'in-month', date: '2026-03-15', household_id: 'hh1' });
    seed({ id: 'date-only-first', date: '2026-03-01', household_id: 'hh1' });
    seed({ id: 'prev-month', date: '2026-02-28', household_id: 'hh1' });
    seed({ id: 'next-month', date: '2026-04-01', household_id: 'hh1' });
    seed({ id: 'other-hh', date: '2026-03-20', household_id: 'hh-other' });
    mockLineItems.push({
      id: 'li-m',
      receipt_id: 'in-month',
      name: 'Milk',
      amount: 5,
      category: 'Groceries',
      split_with: null,
    });

    const rows = await getReceiptsByMonth(2026, 3);
    expect(rows.map((r) => r.id).sort()).toEqual(['date-only-first', 'in-month']);
    const withItems = rows.find((r) => r.id === 'in-month');
    expect(withItems?.lineItems).toEqual([
      expect.objectContaining({ id: 'li-m', name: 'Milk', category: 'Groceries' }),
    ]);
  });

  it('setReceiptPhotoUrl writes only the matching user+household row', async () => {
    seed({ id: 'mine', household_id: 'hh1', photo_url: null });
    seed({ id: 'theirs', household_id: 'hh-other', photo_url: null });

    await setReceiptPhotoUrl('mine', 'https://cdn.example/mine.jpg');
    await setReceiptPhotoUrl('theirs', 'https://cdn.example/leak.jpg');

    expect(mockReceipts.get('mine')?.photo_url).toBe('https://cdn.example/mine.jpg');
    expect(mockReceipts.get('theirs')?.photo_url).toBeNull();

    await setCurrentUserId(null);
    await expect(setReceiptPhotoUrl('mine', 'https://cdn.example/x.jpg')).rejects.toThrow(
      /No authenticated user/,
    );
  });

  it('throws when reading receipts with no signed-in user', async () => {
    await setCurrentUserId(null);
    await expect(getAllReceipts()).rejects.toThrow(/No authenticated user/);
  });
});

describe('saveReceipt / updateReceipt cloud stamp', () => {
  it('stamps user_id + household_id and shadow-writes after the local insert', async () => {
    await saveReceipt(
      cloudReceipt({
        id: 'new-r',
        storeName: 'Fresh',
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:00.000Z',
        lineItems: [{ id: 'li1', name: 'Eggs', amount: 6, category: 'Groceries' }],
      }),
    );

    expect(mockReceipts.get('new-r')).toMatchObject({
      store_name: 'Fresh',
      user_id: 'user-1',
      household_id: 'hh1',
      paid_by: 'user-1',
      created_by: 'user-1',
    });
    expect(mockLineItems).toEqual([
      expect.objectContaining({ id: 'li1', name: 'Eggs', receipt_id: 'new-r' }),
    ]);
    expect(mockSyncReceiptToCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'new-r', storeName: 'Fresh' }),
      'hh1',
    );
  });

  it('persists a frozen fxRate on save and update, and clears it when omitted', async () => {
    await saveReceipt({
      id: 'fx-1',
      storeName: 'Paris Cafe',
      date: '2026-03-15',
      totalAmount: 100,
      category: 'Dining',
      originalCurrency: 'EUR',
      fxRate: 0.95,
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
    });
    expect(mockReceipts.get('fx-1')!.fx_rate).toBe(0.95);

    await updateReceipt({
      id: 'fx-1',
      storeName: 'Paris Cafe',
      date: '2026-03-15',
      totalAmount: 100,
      category: 'Dining',
      originalCurrency: 'EUR',
      fxRate: 0.9,
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
    });
    expect(mockReceipts.get('fx-1')!.fx_rate).toBe(0.9);

    await updateReceipt({
      id: 'fx-1',
      storeName: 'Paris Cafe',
      date: '2026-03-15',
      totalAmount: 100,
      category: 'Dining',
      originalCurrency: 'EUR',
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-15T00:00:00.000Z',
    });
    expect(mockReceipts.get('fx-1')!.fx_rate).toBeNull();
  });

  it('bumps updatedAt before the cloud shadow-write so listeners do not skip the edit', async () => {
    seed({
      id: 'edit-me',
      updated_at: '2026-03-01T00:00:00.000Z',
    });

    await updateReceipt({
      id: 'edit-me',
      storeName: 'Renamed',
      date: '2026-03-15',
      totalAmount: 80,
      category: 'Groceries',
      createdAt: '2026-03-15T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
      split: { enabled: true, method: 'equal', participantIds: ['self'] },
    });

    const local = mockReceipts.get('edit-me')!;
    expect(local.store_name).toBe('Renamed');
    expect(local.updated_at > '2026-03-01T00:00:00.000Z').toBe(true);
    expect(JSON.parse(local.split_json!)).toMatchObject({ enabled: true, method: 'equal' });
    expect(mockSyncReceiptToCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'edit-me',
        storeName: 'Renamed',
        updatedAt: local.updated_at,
      }),
      'hh1',
    );
  });

  it('does not crash when split_json or category_tags are corrupt', async () => {
    seed({
      id: 'bad',
      split_json: '{not-json',
      category_tags: '["oops"',
      category: 'Dining',
    });

    const receipt = await getReceiptById('bad');
    expect(receipt?.split).toBeUndefined();
    expect(receipt?.categoryTags).toEqual(['Dining']);
  });
});
