/**
 * Regression test — "fix: receipt list queries didn't load line items"
 * (lib/database.ts).
 *
 * Original failure mode: receipt-list queries (getAllReceipts,
 * getReceiptById, getReceiptsByMonth, searchReceipts) returned bare
 * header rows straight from `rowToReceipt` without ever joining/batch-
 * loading `line_items` — a receipt fetched from any of these list
 * queries came back with no `lineItems` at all, even though the row
 * clearly had associated line items in the `line_items` table. Fixed by
 * routing every one of these queries through `attachLineItems`, which
 * batch-loads line items for the fetched rows in one extra query.
 *
 * This test mocks `expo-sqlite` with a minimal in-memory table so
 * `getAllReceipts`/`getReceiptById` run against real fixture rows, and
 * asserts the returned Receipt objects actually carry their line items.
 * Against the original bug (rowToReceipt only, no attachLineItems call)
 * `lineItems` would be undefined/empty here.
 */

type ReceiptRow = Record<string, any>;
type LineItemRow = Record<string, any>;

const mockReceiptRows: ReceiptRow[] = [];
const mockLineItemRows: LineItemRow[] = [];

jest.mock('expo-sqlite', () => ({
  openDatabaseSync: () => ({
    execAsync: jest.fn(async () => undefined),
    runAsync: jest.fn(async () => ({ lastInsertRowId: 0, changes: 0 })),
    getAllAsync: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM receipts')) {
        const userId = params[0];
        return mockReceiptRows.filter((r) => r.user_id === userId);
      }
      if (sql.includes('FROM line_items')) {
        // params here are exactly the receipt ids from the IN (...) clause.
        const ids = new Set(params);
        return mockLineItemRows.filter((r) => ids.has(r.receipt_id));
      }
      return [];
    }),
    getFirstAsync: jest.fn(async (sql: string, params: any[]) => {
      if (sql.includes('FROM receipts')) {
        const [id, userId] = params;
        return mockReceiptRows.find((r) => r.id === id && r.user_id === userId) ?? null;
      }
      return null;
    }),
  }),
}));

jest.mock('../../lib/cloudSync', () => ({
  syncReceiptDeletionToCloud: jest.fn(),
  syncReceiptToCloud: jest.fn(),
  syncSettlementToCloud: jest.fn(),
  uploadReceiptPhoto: jest.fn(),
}));

import { getAllReceipts, getReceiptById, setCurrentUserId } from '../../lib/database';

function seedReceiptRow(overrides: Partial<ReceiptRow>): ReceiptRow {
  const row: ReceiptRow = {
    id: 'receipt-1',
    user_id: 'user-1',
    store_name: 'Costco',
    date: '2026-08-01T00:00:00.000Z',
    total_amount: 150,
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
    paid_by: null,
    is_recurring_occurrence: 0,
    household_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
  mockReceiptRows.push(row);
  return row;
}

describe('Regression: receipt list/single-fetch queries load line items (lib/database.ts)', () => {
  beforeEach(async () => {
    mockReceiptRows.length = 0;
    mockLineItemRows.length = 0;
    await setCurrentUserId('user-1');
  });

  it('getAllReceipts includes each receipt\'s line items, not just header fields', async () => {
    seedReceiptRow({ id: 'receipt-1' });
    mockLineItemRows.push(
      { id: 'li-1', receipt_id: 'receipt-1', name: 'Milk', amount: 5, category: 'Groceries', split_with: null },
      { id: 'li-2', receipt_id: 'receipt-1', name: 'Bread', amount: 4, category: 'Groceries', split_with: null },
    );

    const receipts = await getAllReceipts();
    expect(receipts).toHaveLength(1);
    expect(receipts[0].lineItems).toBeDefined();
    expect(receipts[0].lineItems).toHaveLength(2);
    expect(receipts[0].lineItems?.map((i) => i.name).sort()).toEqual(['Bread', 'Milk']);
  });

  it('getReceiptById includes line items for the fetched receipt', async () => {
    seedReceiptRow({ id: 'receipt-2' });
    mockLineItemRows.push(
      { id: 'li-3', receipt_id: 'receipt-2', name: 'Detergent', amount: 12, category: 'Household', split_with: null },
    );

    const receipt = await getReceiptById('receipt-2');
    expect(receipt).not.toBeNull();
    expect(receipt?.lineItems).toHaveLength(1);
    expect(receipt?.lineItems?.[0].name).toBe('Detergent');
  });

  it('parses splitWith, defaults a blank category to Other, and drops corrupt split JSON', async () => {
    seedReceiptRow({ id: 'receipt-3' });
    mockLineItemRows.push(
      {
        id: 'li-split',
        receipt_id: 'receipt-3',
        name: 'Pizza',
        amount: 18,
        category: '  ',
        split_with: JSON.stringify(['self', 'u2']),
      },
      {
        id: 'li-bad',
        receipt_id: 'receipt-3',
        name: 'Soda',
        amount: 3,
        category: null,
        split_with: '{not-json',
      },
    );

    const receipt = await getReceiptById('receipt-3');
    expect(receipt?.lineItems).toEqual([
      expect.objectContaining({
        id: 'li-split',
        name: 'Pizza',
        category: 'Other',
        splitWith: ['self', 'u2'],
      }),
      expect.objectContaining({
        id: 'li-bad',
        name: 'Soda',
        category: 'Other',
        splitWith: undefined,
      }),
    ]);
  });
});
