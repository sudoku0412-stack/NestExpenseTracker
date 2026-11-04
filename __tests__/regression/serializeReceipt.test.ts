/**
 * Firestore rejects a whole document if any nested field is `undefined`.
 * serializeReceipt + stripUndefinedDeep are the last line of defense for
 * equal-split values, optional line-item fields, and omitted tags.
 */

jest.mock('../../lib/customCategories', () => ({
  applyCustomCategories: jest.fn(),
  clearPendingCustomCategoryChanges: jest.fn(),
  getPendingCustomCategoryChanges: jest.fn(async () => ({ add: [], remove: [] })),
}));

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: jest.fn(),
  getCloudMigrationDone: jest.fn(),
  setCloudMigrationDone: jest.fn(),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

jest.mock('@react-native-firebase/firestore', () => ({ default: {} }));
jest.mock('@react-native-firebase/storage', () => ({ default: {} }));

import { serializeReceipt, stripUndefinedDeep } from '../../lib/cloudSync';
import type { Receipt } from '../../types';

const firestore = {
  FieldValue: { serverTimestamp: () => 'SERVER_TS' },
} as never;

const receipt = (overrides: Partial<Receipt> = {}): Receipt => ({
  id: 'r1',
  storeName: 'Costco',
  date: '2026-03-01',
  totalAmount: 12.5,
  category: 'Groceries',
  createdAt: '2026-03-01T00:00:00.000Z',
  updatedAt: '2026-03-01T00:00:00.000Z',
  ...overrides,
});

describe('stripUndefinedDeep', () => {
  it('turns undefined into null, including nested object fields and array slots', () => {
    expect(stripUndefinedDeep(undefined)).toBeNull();
    expect(stripUndefinedDeep({ a: 1, b: undefined, c: { d: undefined } })).toEqual({
      a: 1,
      b: null,
      c: { d: null },
    });
    expect(stripUndefinedDeep([1, undefined, 'x'])).toEqual([1, null, 'x']);
  });

  it('leaves dates, null, and primitives alone', () => {
    const d = new Date('2026-03-01T00:00:00.000Z');
    expect(stripUndefinedDeep(d)).toBe(d);
    expect(stripUndefinedDeep(null)).toBeNull();
    expect(stripUndefinedDeep(0)).toBe(0);
    expect(stripUndefinedDeep('')).toBe('');
  });
});

describe('serializeReceipt', () => {
  it('defaults omitted tags, items, and occurrence flag so Firestore never sees undefined', () => {
    const payload = serializeReceipt(receipt(), firestore);
    expect(payload.categoryTags).toEqual(['Groceries']);
    expect(payload.lineItems).toEqual([]);
    expect(payload.isRecurringOccurrence).toBe(false);
    expect(payload.split).toBeNull();
    expect(payload.notes).toBeNull();
    expect(payload.syncedAt).toBe('SERVER_TS');
  });

  it('coerces equal-split values: undefined → null so the whole receipt still syncs', () => {
    const payload = serializeReceipt(
      receipt({
        split: {
          enabled: true,
          method: 'equal',
          participantIds: ['self', 'u2'],
          values: undefined,
        },
      }),
      firestore,
    );
    expect(payload.split).toEqual({
      enabled: true,
      method: 'equal',
      participantIds: ['self', 'u2'],
      values: null,
    });
  });

  it('writes null category and empty splitWith for items that omitted them', () => {
    const payload = serializeReceipt(
      receipt({
        lineItems: [
          { id: 'i1', name: 'Milk', amount: 4.5 },
          { id: 'i2', name: 'Eggs', amount: 3, category: 'Groceries', splitWith: ['u2'] },
        ],
      }),
      firestore,
    );
    expect(payload.lineItems).toEqual([
      { id: 'i1', name: 'Milk', amount: 4.5, category: null, splitWith: [] },
      { id: 'i2', name: 'Eggs', amount: 3, category: 'Groceries', splitWith: ['u2'] },
    ]);
  });
});
