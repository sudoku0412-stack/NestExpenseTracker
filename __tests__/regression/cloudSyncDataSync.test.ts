/**
 * Receipt / income / settlement / budget cloud mirrors in lib/cloudSync.ts.
 * Household invite tests cover membership; these cover the sync + listener
 * paths that keep household devices from silently diverging.
 */

type Stored = Record<string, unknown>;

const mockStore = new Map<string, Stored>();
let autoId = 0;

type SnapshotNext = (snap: unknown) => void | Promise<void>;
const collectionListeners = new Map<string, SnapshotNext[]>();
const docListeners = new Map<string, SnapshotNext[]>();

function isOp(value: unknown): value is { __op: string; v?: unknown; n?: number } {
  return typeof value === 'object' && value !== null && '__op' in value;
}

function applyFields(existing: Stored | undefined, data: Stored, merge: boolean): Stored {
  const next: Stored = merge ? { ...(existing ?? {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    if (isOp(value) && value.__op === 'serverTimestamp') {
      next[key] = 'SERVER_TS';
    } else {
      next[key] = value;
    }
  }
  return next;
}

type DocSnap = {
  exists: boolean;
  data: () => Stored;
  id: string;
  ref: DocRef;
  metadata: { hasPendingWrites: boolean };
};

type DocRef = {
  path: string;
  id: string;
  get: jest.Mock;
  set: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  collection: (name: string) => ReturnType<typeof makeCollection>;
  onSnapshot: jest.Mock;
};

function makeSnap(path: string, hasPendingWrites = false): DocSnap {
  const data = mockStore.get(path);
  return {
    exists: data !== undefined,
    data: () => data ?? {},
    id: path.split('/').pop() ?? path,
    ref: makeRef(path),
    metadata: { hasPendingWrites },
  };
}

function makeRef(path: string): DocRef {
  return {
    path,
    id: path.split('/').pop() ?? path,
    get: jest.fn(async () => makeSnap(path)),
    set: jest.fn(async (data: Stored, opts?: { merge?: boolean }) => {
      mockStore.set(path, applyFields(mockStore.get(path), data, !!opts?.merge));
    }),
    update: jest.fn(async (data: Stored) => {
      mockStore.set(path, applyFields(mockStore.get(path), data, true));
    }),
    delete: jest.fn(async () => {
      mockStore.delete(path);
    }),
    collection: (name: string) => makeCollection(`${path}/${name}`),
    onSnapshot: jest.fn((onNext: SnapshotNext) => {
      const list = docListeners.get(path) ?? [];
      list.push(onNext);
      docListeners.set(path, list);
      return jest.fn();
    }),
  };
}

function makeCollection(path: string) {
  return {
    doc: (id?: string) => {
      const docId = id ?? `auto-${++autoId}`;
      return makeRef(`${path}/${docId}`);
    },
    get: jest.fn(async () => {
      const prefix = `${path}/`;
      const docs = [];
      for (const [key] of mockStore) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes('/')) continue;
        docs.push(makeSnap(key));
      }
      return { docs };
    }),
    onSnapshot: jest.fn((onNext: SnapshotNext) => {
      const list = collectionListeners.get(path) ?? [];
      list.push(onNext);
      collectionListeners.set(path, list);
      return jest.fn();
    }),
    where: (field: string, op: string, value: unknown) => ({
      get: jest.fn(async () => {
        const prefix = `${path}/`;
        const docs = [];
        for (const [key, data] of mockStore) {
          if (!key.startsWith(prefix)) continue;
          const rest = key.slice(prefix.length);
          if (rest.includes('/')) continue;
          if (op === '==' && data[field] === value) docs.push(makeSnap(key));
        }
        return { docs };
      }),
    }),
  };
}

const mockFirestoreFn = Object.assign(
  () => ({
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const ops: Array<{ type: 'set'; path: string; data: Stored; merge: boolean }> = [];
      return {
        set: (ref: { path: string }, data: Stored, opts?: { merge?: boolean }) => {
          ops.push({ type: 'set', path: ref.path, data, merge: !!opts?.merge });
        },
        commit: jest.fn(async () => {
          for (const op of ops) {
            mockStore.set(op.path, applyFields(mockStore.get(op.path), op.data, op.merge));
          }
        }),
      };
    },
  }),
  {
    FieldValue: {
      serverTimestamp: () => ({ __op: 'serverTimestamp' }),
    },
  },
);

const mockPutFile = jest.fn(async () => undefined);
const mockGetDownloadURL = jest.fn(async () => 'https://cdn.example/photo.jpg');

const mockStorageFn = Object.assign(
  () => ({
    ref: (storagePath: string) => ({
      path: storagePath,
      putFile: mockPutFile,
      getDownloadURL: mockGetDownloadURL,
      delete: jest.fn(async () => undefined),
    }),
  }),
);

jest.mock('@react-native-firebase/firestore', () => ({
  default: mockFirestoreFn,
}));

jest.mock('@react-native-firebase/storage', () => ({
  default: mockStorageFn,
}));

const mockApplyBudgetsSnapshot = jest.fn();
const mockGetCloudMigrationDone = jest.fn();
const mockSetCloudMigrationDone = jest.fn();

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: (...args: unknown[]) => mockApplyBudgetsSnapshot(...args),
  getCloudMigrationDone: (...args: unknown[]) => mockGetCloudMigrationDone(...args),
  setCloudMigrationDone: (...args: unknown[]) => mockSetCloudMigrationDone(...args),
}));

const mockNotifyLocalDataChanged = jest.fn();
jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: (...args: unknown[]) => mockNotifyLocalDataChanged(...args),
}));

const mockUpsertReceiptFromCloud = jest.fn();
const mockDeleteReceiptLocally = jest.fn();
const mockSetReceiptPhotoUrl = jest.fn();
const mockUpsertSettlementFromCloud = jest.fn();
const mockUpsertIncomeFromCloud = jest.fn();
const mockDeleteIncomeFromCloud = jest.fn();
const mockUpsertSavingsGoalFromCloud = jest.fn();
const mockDeleteSavingsGoalFromCloud = jest.fn();
const mockUpsertInvestmentAccountFromCloud = jest.fn();
const mockDeleteInvestmentAccountFromCloud = jest.fn();
const mockUpsertInvestmentSnapshotFromCloud = jest.fn();
const mockDeleteInvestmentSnapshotFromCloud = jest.fn();
const mockGetAllInvestmentAccounts = jest.fn();
const mockGetAllInvestmentSnapshots = jest.fn();

jest.mock('../../lib/database', () => ({
  upsertReceiptFromCloud: (...args: unknown[]) => mockUpsertReceiptFromCloud(...args),
  deleteReceiptLocally: (...args: unknown[]) => mockDeleteReceiptLocally(...args),
  setReceiptPhotoUrl: (...args: unknown[]) => mockSetReceiptPhotoUrl(...args),
  upsertSettlementFromCloud: (...args: unknown[]) => mockUpsertSettlementFromCloud(...args),
  upsertIncomeFromCloud: (...args: unknown[]) => mockUpsertIncomeFromCloud(...args),
  deleteIncomeFromCloud: (...args: unknown[]) => mockDeleteIncomeFromCloud(...args),
  upsertSavingsGoalFromCloud: (...args: unknown[]) => mockUpsertSavingsGoalFromCloud(...args),
  deleteSavingsGoalFromCloud: (...args: unknown[]) => mockDeleteSavingsGoalFromCloud(...args),
  upsertInvestmentAccountFromCloud: (...args: unknown[]) => mockUpsertInvestmentAccountFromCloud(...args),
  deleteInvestmentAccountFromCloud: (...args: unknown[]) => mockDeleteInvestmentAccountFromCloud(...args),
  upsertInvestmentSnapshotFromCloud: (...args: unknown[]) => mockUpsertInvestmentSnapshotFromCloud(...args),
  deleteInvestmentSnapshotFromCloud: (...args: unknown[]) => mockDeleteInvestmentSnapshotFromCloud(...args),
  getAllInvestmentAccounts: (...args: unknown[]) => mockGetAllInvestmentAccounts(...args),
  getAllInvestmentSnapshots: (...args: unknown[]) => mockGetAllInvestmentSnapshots(...args),
}));

import { Receipt, Income, Settlement } from '../../types';
import {
  getHouseholdMemberPushTokens,
  getPushTokensForUids,
  migrateLocalReceiptsToCloud,
  subscribeToHouseholdBudgets,
  subscribeToHouseholdIncomes,
  subscribeToHouseholdReceipts,
  subscribeToHouseholdSettlements,
  subscribeToInvestments,
  syncIncomeDeletionToCloud,
  syncIncomeToCloud,
  syncPhoneToCloud,
  syncPushTokenToCloud,
  syncReceiptDeletionToCloud,
  syncReceiptToCloud,
  syncSavingsGoalDeletionToCloud,
  syncSettlementToCloud,
  syncInvestmentAccountDeletionToCloud,
  syncInvestmentAccountToCloud,
  syncInvestmentSnapshotToCloud,
  uploadReceiptPhoto,
} from '../../lib/cloudSync';

function seed(path: string, data: Stored) {
  mockStore.set(path, data);
}

function receipt(overrides: Partial<Receipt> = {}): Receipt {
  return {
    id: 'r1',
    storeName: 'Costco',
    date: '2026-09-01',
    totalAmount: 42.5,
    category: 'Groceries',
    createdAt: '2026-09-01T12:00:00.000Z',
    updatedAt: '2026-09-01T12:00:00.000Z',
    ...overrides,
  };
}

function fireCollection(path: string, changes: Array<{
  type: 'added' | 'modified' | 'removed';
  id: string;
  data?: Stored;
  hasPendingWrites?: boolean;
}>) {
  const snap = {
    docChanges: () =>
      changes.map((c) => ({
        type: c.type,
        doc: {
          id: c.id,
          metadata: { hasPendingWrites: !!c.hasPendingWrites },
          data: () => c.data ?? {},
        },
      })),
  };
  for (const fn of collectionListeners.get(path) ?? []) {
    void fn(snap);
  }
}

beforeEach(() => {
  mockStore.clear();
  autoId = 0;
  collectionListeners.clear();
  docListeners.clear();
  jest.clearAllMocks();
  mockApplyBudgetsSnapshot.mockResolvedValue(undefined);
  mockGetCloudMigrationDone.mockResolvedValue(false);
  mockSetCloudMigrationDone.mockResolvedValue(undefined);
  mockUpsertReceiptFromCloud.mockResolvedValue(undefined);
  mockDeleteReceiptLocally.mockResolvedValue(undefined);
  mockSetReceiptPhotoUrl.mockResolvedValue(undefined);
  mockUpsertSettlementFromCloud.mockResolvedValue(undefined);
  mockUpsertIncomeFromCloud.mockResolvedValue(undefined);
  mockDeleteIncomeFromCloud.mockResolvedValue(undefined);
  mockUpsertSavingsGoalFromCloud.mockResolvedValue(undefined);
  mockDeleteSavingsGoalFromCloud.mockResolvedValue(undefined);
  mockUpsertInvestmentAccountFromCloud.mockResolvedValue(undefined);
  mockDeleteInvestmentAccountFromCloud.mockResolvedValue(undefined);
  mockUpsertInvestmentSnapshotFromCloud.mockResolvedValue(undefined);
  mockDeleteInvestmentSnapshotFromCloud.mockResolvedValue(undefined);
  mockGetAllInvestmentAccounts.mockResolvedValue([]);
  mockGetAllInvestmentSnapshots.mockResolvedValue([]);
  mockPutFile.mockResolvedValue(undefined);
  mockGetDownloadURL.mockResolvedValue('https://cdn.example/photo.jpg');
});

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('push tokens', () => {
  it('syncPushTokenToCloud merges the token onto users/{uid} without wiping existing fields', async () => {
    seed('users/u1', { displayName: 'Ada', email: 'ada@example.com' });
    await syncPushTokenToCloud('u1', 'ExponentPushToken[abc]');
    expect(mockStore.get('users/u1')).toEqual(
      expect.objectContaining({
        displayName: 'Ada',
        email: 'ada@example.com',
        pushToken: 'ExponentPushToken[abc]',
      }),
    );
  });

  it('getPushTokensForUids drops missing/empty tokens', async () => {
    seed('users/a', { pushToken: 'tok-a' });
    seed('users/b', { displayName: 'No token' });
    seed('users/c', { pushToken: 'tok-c' });
    await expect(getPushTokensForUids(['a', 'b', 'c'])).resolves.toEqual(['tok-a', 'tok-c']);
    await expect(getPushTokensForUids([])).resolves.toEqual([]);
  });

  it('getHouseholdMemberPushTokens excludes the caller uid', async () => {
    seed('households/hh1', { memberUids: ['me', 'other', 'third'] });
    seed('users/me', { pushToken: 'tok-me' });
    seed('users/other', { pushToken: 'tok-other' });
    seed('users/third', { pushToken: 'tok-third' });
    await expect(getHouseholdMemberPushTokens('hh1', 'me')).resolves.toEqual(['tok-other', 'tok-third']);
  });
});

describe('phone + receipt shadow writes', () => {
  it('syncPhoneToCloud merges phone fields and leaves unrelated user data', async () => {
    seed('users/u1', { displayName: 'Ada', pushToken: 'keep-me' });
    await syncPhoneToCloud('u1', '+15555550100', true);
    expect(mockStore.get('users/u1')).toEqual(
      expect.objectContaining({
        displayName: 'Ada',
        pushToken: 'keep-me',
        phone: '+15555550100',
        phoneVerified: true,
      }),
    );
  });

  it('syncReceiptToCloud strips undefined equal-split values so Firestore does not reject the write', async () => {
    await syncReceiptToCloud(
      receipt({
        split: {
          enabled: true,
          method: 'equal',
          participantIds: ['self', 'u2'],
          values: undefined,
        },
      }),
      'hh1',
    );
    const stored = mockStore.get('households/hh1/receipts/r1') as Stored;
    expect(stored).toBeDefined();
    expect(stored.split).toEqual({
      enabled: true,
      method: 'equal',
      participantIds: ['self', 'u2'],
      values: null,
    });
    expect(stored.syncedAt).toBe('SERVER_TS');
  });

  it('syncReceiptToCloud uploads a local photo then writes photoUrl and caches it locally', async () => {
    await syncReceiptToCloud(receipt({ imageUri: 'file://local.jpg', photoUrl: undefined }), 'hh1');
    expect(mockPutFile).toHaveBeenCalledWith('file://local.jpg');
    expect(mockSetReceiptPhotoUrl).toHaveBeenCalledWith('r1', 'https://cdn.example/photo.jpg');
    expect(mockStore.get('households/hh1/receipts/r1')).toEqual(
      expect.objectContaining({
        photoUrl: 'https://cdn.example/photo.jpg',
        imageUri: 'file://local.jpg',
      }),
    );
  });

  it('syncReceiptToCloud no-ops without a household id', async () => {
    await syncReceiptToCloud(receipt(), '');
    expect(mockStore.size).toBe(0);
    expect(mockPutFile).not.toHaveBeenCalled();
  });

  it('syncReceiptDeletionToCloud removes the cloud receipt doc', async () => {
    seed('households/hh1/receipts/r1', { storeName: 'Costco' });
    await syncReceiptDeletionToCloud('r1', 'hh1');
    expect(mockStore.has('households/hh1/receipts/r1')).toBe(false);
  });
});

describe('income and settlement shadow writes', () => {
  it('syncIncomeToCloud writes mutable income fields including recurring', async () => {
    const income: Income = {
      id: 'inc-1',
      sourceName: 'Payroll',
      date: '2026-09-15',
      amountUsd: 1200,
      category: 'Salary',
      earnedBy: 'u1',
      notes: 'biweekly',
      recurring: { frequency: 'biweekly', nextDueDate: '2026-09-29', endDate: '2026-12-31' },
      createdBy: 'u1',
      createdAt: '2026-09-15T00:00:00.000Z',
      updatedAt: '2026-09-15T00:00:00.000Z',
    };
    await syncIncomeToCloud(income, 'hh1');
    expect(mockStore.get('households/hh1/incomes/inc-1')).toEqual(
      expect.objectContaining({
        sourceName: 'Payroll',
        amountUsd: 1200,
        earnedBy: 'u1',
        recurring: { frequency: 'biweekly', nextDueDate: '2026-09-29', endDate: '2026-12-31' },
        isRecurringOccurrence: false,
      }),
    );
  });

  it('syncIncomeDeletionToCloud deletes the income doc', async () => {
    seed('households/hh1/incomes/inc-1', { sourceName: 'Payroll' });
    await syncIncomeDeletionToCloud('inc-1', 'hh1');
    expect(mockStore.has('households/hh1/incomes/inc-1')).toBe(false);
  });

  it('syncSettlementToCloud writes an immutable ledger row', async () => {
    const settlement: Settlement = {
      id: 's1',
      fromUid: 'a',
      toUid: 'b',
      amountUsd: 33.25,
      createdAt: '2026-09-20T00:00:00.000Z',
    };
    await syncSettlementToCloud(settlement, 'hh1');
    expect(mockStore.get('households/hh1/settlements/s1')).toEqual({
      fromUid: 'a',
      toUid: 'b',
      amountUsd: 33.25,
      createdAt: '2026-09-20T00:00:00.000Z',
    });
  });

  it('syncSavingsGoalDeletionToCloud deletes the goal doc', async () => {
    seed('households/hh1/savingsGoals/g1', { name: 'Vacation' });
    await syncSavingsGoalDeletionToCloud('g1', 'hh1');
    expect(mockStore.has('households/hh1/savingsGoals/g1')).toBe(false);
  });
});

describe('household snapshot listeners', () => {
  it('subscribe helpers return null when household or uid is missing', () => {
    expect(subscribeToHouseholdReceipts('', 'u1')).toBeNull();
    expect(subscribeToHouseholdReceipts('hh1', '')).toBeNull();
    expect(subscribeToHouseholdSettlements('', 'u1')).toBeNull();
    expect(subscribeToHouseholdIncomes('hh1', '')).toBeNull();
    expect(subscribeToHouseholdBudgets('')).toBeNull();
  });

  it('receipt listener skips pending local writes, upserts remote docs, deletes removals, and notifies', async () => {
    const unsub = subscribeToHouseholdReceipts('hh1', 'u1');
    expect(unsub).toEqual(expect.any(Function));

    fireCollection('households/hh1/receipts', [
      {
        type: 'modified',
        id: 'local-pending',
        data: { id: 'local-pending', storeName: 'Skip me' },
        hasPendingWrites: true,
      },
      {
        type: 'added',
        id: 'remote',
        data: { id: 'remote', storeName: 'Trader Joes', date: '2026-09-02', totalAmount: 12 },
      },
      { type: 'removed', id: 'gone' },
    ]);
    await flush();

    expect(mockUpsertReceiptFromCloud).toHaveBeenCalledTimes(1);
    expect(mockUpsertReceiptFromCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'remote', storeName: 'Trader Joes' }),
      'u1',
      'hh1',
    );
    expect(mockDeleteReceiptLocally).toHaveBeenCalledWith('gone', 'u1', 'hh1');
    expect(mockNotifyLocalDataChanged).toHaveBeenCalled();
  });

  it('settlement listener never applies removals (settlements are immutable)', async () => {
    subscribeToHouseholdSettlements('hh1', 'u1');
    fireCollection('households/hh1/settlements', [
      {
        type: 'added',
        id: 's1',
        data: { fromUid: 'a', toUid: 'b', amountUsd: 10, createdAt: '2026-09-01T00:00:00.000Z' },
      },
      { type: 'removed', id: 's-old' },
    ]);
    await flush();

    expect(mockUpsertSettlementFromCloud).toHaveBeenCalledTimes(1);
    expect(mockUpsertSettlementFromCloud).toHaveBeenCalledWith(
      {
        id: 's1',
        fromUid: 'a',
        toUid: 'b',
        amountUsd: 10,
        createdAt: '2026-09-01T00:00:00.000Z',
      },
      'u1',
      'hh1',
    );
  });

  it('income listener upserts remote rows and deletes removals', async () => {
    subscribeToHouseholdIncomes('hh1', 'u1');
    fireCollection('households/hh1/incomes', [
      {
        type: 'added',
        id: 'inc-2',
        data: {
          sourceName: 'Side gig',
          date: '2026-09-10',
          amountUsd: 80,
          category: 'Freelance',
          earnedBy: 'u2',
        },
      },
      { type: 'removed', id: 'inc-old' },
    ]);
    await flush();

    expect(mockDeleteIncomeFromCloud).toHaveBeenCalledWith('inc-old', 'u1', 'hh1');
    expect(mockUpsertIncomeFromCloud).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'inc-2',
        sourceName: 'Side gig',
        amountUsd: 80,
        earnedBy: 'u2',
      }),
      'u1',
      'hh1',
    );
  });

  it('budget listener skips this device pending write and applies remote budgets', async () => {
    subscribeToHouseholdBudgets('hh1');
    const handlers = docListeners.get('households/hh1') ?? [];
    expect(handlers.length).toBe(1);

    await handlers[0]({
      exists: true,
      metadata: { hasPendingWrites: true },
      data: () => ({ budgets: { Groceries: 100 } }),
    });
    expect(mockApplyBudgetsSnapshot).not.toHaveBeenCalled();

    await handlers[0]({
      exists: true,
      metadata: { hasPendingWrites: false },
      data: () => ({ budgets: { Groceries: 250, alertsEnabled: true } }),
    });
    expect(mockApplyBudgetsSnapshot).toHaveBeenCalledWith('hh1', {
      Groceries: 250,
      alertsEnabled: true,
    });
    expect(mockNotifyLocalDataChanged).toHaveBeenCalled();
  });
});

describe('uploadReceiptPhoto', () => {
  it('puts the local file at households/{hid}/photos/{rid}.jpg and returns the download URL', async () => {
    const url = await uploadReceiptPhoto({
      localUri: 'file://shot.jpg',
      householdId: 'hh1',
      receiptId: 'r9',
    });
    expect(url).toBe('https://cdn.example/photo.jpg');
    expect(mockPutFile).toHaveBeenCalledWith('file://shot.jpg');
  });

  it('returns null when household or local uri is missing', async () => {
    await expect(
      uploadReceiptPhoto({ localUri: '', householdId: 'hh1', receiptId: 'r9' }),
    ).resolves.toBeNull();
    await expect(
      uploadReceiptPhoto({ localUri: 'file://x.jpg', householdId: '', receiptId: 'r9' }),
    ).resolves.toBeNull();
  });
});

describe('migrateLocalReceiptsToCloud', () => {
  it('skips when the per-user marker is already set', async () => {
    mockGetCloudMigrationDone.mockResolvedValue(true);
    const result = await migrateLocalReceiptsToCloud({
      uid: 'u1',
      householdId: 'hh1',
      loadAllReceipts: async () => [receipt()],
    });
    expect(result).toEqual({ migrated: 0, failed: 0, skipped: true });
    expect(mockStore.size).toBe(0);
    expect(mockSetCloudMigrationDone).not.toHaveBeenCalled();
  });

  it('skips when household id is empty', async () => {
    const result = await migrateLocalReceiptsToCloud({
      uid: 'u1',
      householdId: '',
      loadAllReceipts: async () => [receipt()],
    });
    expect(result).toEqual({ migrated: 0, failed: 0, skipped: true });
  });

  it('uploads local receipts in a batch and marks migration done on success', async () => {
    const result = await migrateLocalReceiptsToCloud({
      uid: 'u1',
      householdId: 'hh1',
      loadAllReceipts: async () => [receipt({ id: 'r-a' }), receipt({ id: 'r-b', storeName: 'Aldi' })],
    });
    expect(result).toEqual({ migrated: 2, failed: 0, skipped: false });
    expect(mockStore.get('households/hh1/receipts/r-a')).toEqual(
      expect.objectContaining({ storeName: 'Costco' }),
    );
    expect(mockStore.get('households/hh1/receipts/r-b')).toEqual(
      expect.objectContaining({ storeName: 'Aldi' }),
    );
    expect(mockSetCloudMigrationDone).toHaveBeenCalledWith('u1');
  });
});

describe('investments cloud (personal users/{uid} space)', () => {
  const account = {
    id: 'a1',
    name: 'TFSA',
    kind: 'etf' as const,
    contributedUsd: 1000,
    valueUsd: 1200,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z',
  };

  it('writes accounts and snapshots under the user, never a household', async () => {
    await syncInvestmentAccountToCloud(account, 'u1');
    await syncInvestmentSnapshotToCloud(
      {
        id: 's1',
        accountId: 'a1',
        date: '2026-02-01',
        valueUsd: 1300,
        contributedUsd: 1000,
        createdAt: '2026-02-01T00:00:00.000Z',
      },
      'u1',
    );
    expect(mockStore.get('users/u1/investmentAccounts/a1')).toEqual(
      expect.objectContaining({ name: 'TFSA', kind: 'etf', valueUsd: 1200 }),
    );
    expect(mockStore.get('users/u1/investmentSnapshots/s1')).toEqual(
      expect.objectContaining({ accountId: 'a1', date: '2026-02-01' }),
    );
    expect([...mockStore.keys()].some((k) => k.startsWith('households/'))).toBe(false);
  });

  it('no-ops when uid is empty', async () => {
    await syncInvestmentAccountToCloud(account, '');
    expect(mockStore.size).toBe(0);
  });

  it('deletes matching snapshots then the account', async () => {
    seed('users/u1/investmentAccounts/a1', { name: 'TFSA' });
    seed('users/u1/investmentSnapshots/s1', { accountId: 'a1' });
    seed('users/u1/investmentSnapshots/s-other', { accountId: 'a2' });
    await syncInvestmentAccountDeletionToCloud('a1', 'u1');
    expect(mockStore.has('users/u1/investmentAccounts/a1')).toBe(false);
    expect(mockStore.has('users/u1/investmentSnapshots/s1')).toBe(false);
    expect(mockStore.has('users/u1/investmentSnapshots/s-other')).toBe(true);
  });

  it('subscribeToInvestments returns null without a uid', () => {
    expect(subscribeToInvestments('')).toBeNull();
  });

  it('maps unknown kinds to other, skips pending writes, and applies remote deletes', async () => {
    const unsub = subscribeToInvestments('u1');
    expect(unsub).toEqual(expect.any(Function));

    fireCollection('users/u1/investmentAccounts', [
      { type: 'added', id: 'local', data: { name: 'skip' }, hasPendingWrites: true },
      { type: 'added', id: 'a2', data: { name: 'Coin', kind: 'not-a-kind', contributedUsd: 10, valueUsd: 12 } },
      { type: 'removed', id: 'gone' },
    ]);
    fireCollection('users/u1/investmentSnapshots', [
      { type: 'added', id: 's2', data: { accountId: 'a2', date: '2026-03-01', valueUsd: 12, contributedUsd: 10 } },
      { type: 'removed', id: 's-gone' },
    ]);
    await flush();

    expect(mockUpsertInvestmentAccountFromCloud).toHaveBeenCalledTimes(1);
    expect(mockUpsertInvestmentAccountFromCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a2', name: 'Coin', kind: 'other', valueUsd: 12 }),
      'u1',
    );
    expect(mockDeleteInvestmentAccountFromCloud).toHaveBeenCalledWith('gone', 'u1');
    expect(mockUpsertInvestmentSnapshotFromCloud).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's2', accountId: 'a2', date: '2026-03-01' }),
      'u1',
    );
    expect(mockDeleteInvestmentSnapshotFromCloud).toHaveBeenCalledWith('s-gone', 'u1');
    expect(mockNotifyLocalDataChanged).toHaveBeenCalled();
  });
});
