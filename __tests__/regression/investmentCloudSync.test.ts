/**
 * Personal investment shadow-writes and listeners in lib/cloudSync.ts.
 * Holdings live under users/{uid}, never the household.
 */

type Stored = Record<string, unknown>;

const mockStore = new Map<string, Stored>();
const collectionListeners = new Map<string, Array<(snap: unknown) => void | Promise<void>>>();

function docsIn(path: string) {
  const prefix = `${path}/`;
  const docs = [];
  for (const [key] of mockStore) {
    if (!key.startsWith(prefix)) continue;
    if (key.slice(prefix.length).includes('/')) continue;
    docs.push(makeSnap(key));
  }
  return docs;
}

function makeSnap(path: string) {
  const data = mockStore.get(path);
  return {
    exists: data !== undefined,
    data: () => data ?? {},
    id: path.split('/').pop() ?? path,
    ref: {
      path,
      delete: jest.fn(async () => {
        mockStore.delete(path);
      }),
    },
    metadata: { hasPendingWrites: false },
  };
}

function mockMakeCollection(path: string) {
  return {
    doc: (id: string) => mockMakeRef(`${path}/${id}`),
    get: jest.fn(async () => ({ docs: docsIn(path) })),
    where: (field: string, _op: string, value: unknown) => ({
      get: jest.fn(async () => ({
        docs: docsIn(path).filter((d) => d.data()[field] === value),
      })),
    }),
    onSnapshot: jest.fn((onNext: (snap: unknown) => void) => {
      const list = collectionListeners.get(path) ?? [];
      list.push(onNext);
      collectionListeners.set(path, list);
      return jest.fn();
    }),
  };
}

function mockMakeRef(path: string) {
  return {
    path,
    id: path.split('/').pop() ?? path,
    get: jest.fn(async () => makeSnap(path)),
    set: jest.fn(async (data: Stored) => {
      mockStore.set(path, { ...(mockStore.get(path) ?? {}), ...data });
    }),
    delete: jest.fn(async () => {
      mockStore.delete(path);
    }),
    collection: (name: string) => mockMakeCollection(`${path}/${name}`),
  };
}

jest.mock('@react-native-firebase/firestore', () => ({
  default: () => ({
    collection: (name: string) => mockMakeCollection(name),
  }),
}));

jest.mock('@react-native-firebase/storage', () => ({
  default: () => ({}),
}));

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: jest.fn(),
  getCloudMigrationDone: jest.fn(),
  setCloudMigrationDone: jest.fn(),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

const mockUpsertAccount = jest.fn();
const mockDeleteAccount = jest.fn();
const mockUpsertSnap = jest.fn();
const mockDeleteSnap = jest.fn();
const mockGetAllAccounts = jest.fn();
const mockGetAllSnaps = jest.fn();

jest.mock('../../lib/database', () => ({
  upsertInvestmentAccountFromCloud: (...a: unknown[]) => mockUpsertAccount(...a),
  deleteInvestmentAccountFromCloud: (...a: unknown[]) => mockDeleteAccount(...a),
  upsertInvestmentSnapshotFromCloud: (...a: unknown[]) => mockUpsertSnap(...a),
  deleteInvestmentSnapshotFromCloud: (...a: unknown[]) => mockDeleteSnap(...a),
  getAllInvestmentAccounts: (...a: unknown[]) => mockGetAllAccounts(...a),
  getAllInvestmentSnapshots: (...a: unknown[]) => mockGetAllSnaps(...a),
}));

import {
  subscribeToInvestments,
  syncInvestmentAccountDeletionToCloud,
  syncInvestmentAccountToCloud,
  syncInvestmentSnapshotToCloud,
} from '../../lib/cloudSync';
import type { InvestmentAccount, InvestmentSnapshot } from '../../types';

function fireCollection(
  path: string,
  changes: Array<{ type: 'added' | 'modified' | 'removed'; id: string; data?: Stored; hasPendingWrites?: boolean }>,
) {
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
  for (const fn of collectionListeners.get(path) ?? []) void fn(snap);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const account = (o: Partial<InvestmentAccount> = {}): InvestmentAccount => ({
  id: 'a1',
  name: 'TFSA',
  kind: 'etf',
  contributedUsd: 1000,
  valueUsd: 1200,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...o,
});

const snapshot = (o: Partial<InvestmentSnapshot> = {}): InvestmentSnapshot => ({
  id: 's1',
  accountId: 'a1',
  date: '2026-02-01',
  valueUsd: 1300,
  contributedUsd: 1000,
  createdAt: '2026-02-01T00:00:00.000Z',
  ...o,
});

beforeEach(() => {
  mockStore.clear();
  collectionListeners.clear();
  jest.clearAllMocks();
  mockGetAllAccounts.mockResolvedValue([]);
  mockGetAllSnaps.mockResolvedValue([]);
  mockUpsertAccount.mockResolvedValue(undefined);
  mockDeleteAccount.mockResolvedValue(undefined);
  mockUpsertSnap.mockResolvedValue(undefined);
  mockDeleteSnap.mockResolvedValue(undefined);
});

describe('investment shadow writes', () => {
  it('no-ops without a uid', async () => {
    await syncInvestmentAccountToCloud(account(), '');
    expect(mockStore.size).toBe(0);
  });

  it('writes the account under users/{uid}/investmentAccounts, never a household path', async () => {
    await syncInvestmentAccountToCloud(account({ notes: 'rrsp' }), 'u1');
    expect(mockStore.get('users/u1/investmentAccounts/a1')).toEqual({
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 1000,
      valueUsd: 1200,
      notes: 'rrsp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    });
    expect([...mockStore.keys()].some((k) => k.includes('households'))).toBe(false);
  });

  it('writes snapshots under the same user space', async () => {
    await syncInvestmentSnapshotToCloud(snapshot(), 'u1');
    expect(mockStore.get('users/u1/investmentSnapshots/s1')).toMatchObject({
      accountId: 'a1',
      valueUsd: 1300,
    });
  });

  it('deletes matching snapshots then the account', async () => {
    mockStore.set('users/u1/investmentSnapshots/s1', { accountId: 'a1' });
    mockStore.set('users/u1/investmentSnapshots/other', { accountId: 'a2' });
    mockStore.set('users/u1/investmentAccounts/a1', { name: 'TFSA' });
    await syncInvestmentAccountDeletionToCloud('a1', 'u1');
    expect(mockStore.has('users/u1/investmentSnapshots/s1')).toBe(false);
    expect(mockStore.has('users/u1/investmentSnapshots/other')).toBe(true);
    expect(mockStore.has('users/u1/investmentAccounts/a1')).toBe(false);
  });
});

describe('subscribeToInvestments', () => {
  it('skips this-device pending writes and maps unknown kinds to other', async () => {
    subscribeToInvestments('u1');
    fireCollection('users/u1/investmentAccounts', [
      { type: 'added', id: 'local', data: { name: 'skip' }, hasPendingWrites: true },
      { type: 'added', id: 'a2', data: { name: 'Broker', kind: 'yacht', contributedUsd: 1, valueUsd: 2 } },
    ]);
    await flush();
    expect(mockUpsertAccount).toHaveBeenCalledTimes(1);
    expect(mockUpsertAccount.mock.calls[0][0]).toMatchObject({ id: 'a2', kind: 'other', name: 'Broker' });
  });

  it('applies remote deletes to local SQLite', async () => {
    subscribeToInvestments('u1');
    fireCollection('users/u1/investmentAccounts', [{ type: 'removed', id: 'gone' }]);
    fireCollection('users/u1/investmentSnapshots', [{ type: 'removed', id: 'snap-gone' }]);
    await flush();
    expect(mockDeleteAccount).toHaveBeenCalledWith('gone', 'u1');
    expect(mockDeleteSnap).toHaveBeenCalledWith('snap-gone', 'u1');
  });
});
