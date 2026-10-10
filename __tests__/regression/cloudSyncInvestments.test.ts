/**
 * Personal investment shadow-writes and listeners in lib/cloudSync.ts (#101).
 * DB tests mock these functions; this file covers the Firestore paths so a
 * phone save actually reaches users/{uid} (and the web) without leaking
 * holdings into the household.
 */

type Stored = Record<string, unknown>;

const mockStore = new Map<string, Stored>();
const collectionListeners = new Map<string, Array<(snap: unknown) => void | Promise<void>>>();
let autoId = 0;

type SnapshotNext = (snap: unknown) => void | Promise<void>;

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
  delete: jest.Mock;
  collection: (name: string) => ReturnType<typeof makeCollection>;
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
    set: jest.fn(async (data: Stored) => {
      mockStore.set(path, { ...(mockStore.get(path) ?? {}), ...data });
    }),
    delete: jest.fn(async () => {
      mockStore.delete(path);
    }),
    collection: (name: string) => makeCollection(`${path}/${name}`),
  };
}

function docsIn(path: string): string[] {
  const prefix = `${path}/`;
  const ids: string[] = [];
  for (const key of mockStore.keys()) {
    if (!key.startsWith(prefix)) continue;
    const rest = key.slice(prefix.length);
    if (!rest.includes('/')) ids.push(key);
  }
  return ids;
}

function makeCollection(path: string) {
  return {
    doc: (id?: string) => makeRef(`${path}/${id ?? `auto-${++autoId}`}`),
    get: jest.fn(async () => ({
      docs: docsIn(path).map((key) => makeSnap(key)),
    })),
    where: (field: string, op: string, value: unknown) => ({
      get: jest.fn(async () => ({
        docs: docsIn(path)
          .filter((key) => op === '==' && mockStore.get(key)?.[field] === value)
          .map((key) => makeSnap(key)),
      })),
    }),
    onSnapshot: jest.fn((onNext: SnapshotNext) => {
      const list = collectionListeners.get(path) ?? [];
      list.push(onNext);
      collectionListeners.set(path, list);
      return jest.fn();
    }),
  };
}

const mockFirestoreFn = Object.assign(
  () => ({
    collection: (name: string) => makeCollection(name),
  }),
  { FieldValue: { serverTimestamp: () => ({ __op: 'serverTimestamp' }) } },
);

jest.mock('@react-native-firebase/firestore', () => ({
  default: mockFirestoreFn,
}));

jest.mock('@react-native-firebase/storage', () => ({
  default: () => ({}),
}));

const mockNotify = jest.fn();
jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: (...a: unknown[]) => mockNotify(...a),
}));

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: jest.fn(),
  getCloudMigrationDone: jest.fn(),
  setCloudMigrationDone: jest.fn(),
}));

const mockUpsertAccount = jest.fn();
const mockDeleteAccount = jest.fn();
const mockUpsertSnap = jest.fn();
const mockDeleteSnap = jest.fn();
const mockGetAccounts = jest.fn();
const mockGetSnaps = jest.fn();

jest.mock('../../lib/database', () => ({
  upsertInvestmentAccountFromCloud: (...a: unknown[]) => mockUpsertAccount(...a),
  deleteInvestmentAccountFromCloud: (...a: unknown[]) => mockDeleteAccount(...a),
  upsertInvestmentSnapshotFromCloud: (...a: unknown[]) => mockUpsertSnap(...a),
  deleteInvestmentSnapshotFromCloud: (...a: unknown[]) => mockDeleteSnap(...a),
  getAllInvestmentAccounts: (...a: unknown[]) => mockGetAccounts(...a),
  getAllInvestmentSnapshots: (...a: unknown[]) => mockGetSnaps(...a),
}));

import type { InvestmentAccount, InvestmentSnapshot } from '../../types';
import {
  subscribeToInvestments,
  syncInvestmentAccountDeletionToCloud,
  syncInvestmentAccountToCloud,
  syncInvestmentSnapshotToCloud,
} from '../../lib/cloudSync';

function seed(path: string, data: Stored) {
  mockStore.set(path, data);
}

function account(o: Partial<InvestmentAccount> = {}): InvestmentAccount {
  return {
    id: 'a1',
    name: 'TFSA',
    kind: 'etf',
    contributedUsd: 1000,
    valueUsd: 1200,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-03-01T00:00:00.000Z',
    ...o,
  };
}

function snap(o: Partial<InvestmentSnapshot> = {}): InvestmentSnapshot {
  return {
    id: 's1',
    accountId: 'a1',
    date: '2026-03-01',
    valueUsd: 1300,
    contributedUsd: 1000,
    createdAt: '2026-03-01T00:00:00.000Z',
    ...o,
  };
}

function fireCollection(
  path: string,
  changes: Array<{ type: 'added' | 'modified' | 'removed'; id: string; data?: Stored; hasPendingWrites?: boolean }>,
) {
  const payload = {
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
  for (const fn of collectionListeners.get(path) ?? []) void fn(payload);
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  mockStore.clear();
  autoId = 0;
  collectionListeners.clear();
  jest.clearAllMocks();
  mockGetAccounts.mockResolvedValue([]);
  mockGetSnaps.mockResolvedValue([]);
  mockUpsertAccount.mockResolvedValue(undefined);
  mockDeleteAccount.mockResolvedValue(undefined);
  mockUpsertSnap.mockResolvedValue(undefined);
  mockDeleteSnap.mockResolvedValue(undefined);
});

describe('investment shadow writes', () => {
  it('writes the account under users/{uid}, never a household path', async () => {
    await syncInvestmentAccountToCloud(account({ notes: 'rrsp' }), 'u1');
    expect(mockStore.get('users/u1/investmentAccounts/a1')).toEqual({
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 1000,
      valueUsd: 1200,
      notes: 'rrsp',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-03-01T00:00:00.000Z',
    });
    expect([...mockStore.keys()].some((k) => k.includes('households'))).toBe(false);
  });

  it('writes a snapshot under the same user and no-ops without a uid', async () => {
    await syncInvestmentSnapshotToCloud(snap(), 'u1');
    expect(mockStore.get('users/u1/investmentSnapshots/s1')).toEqual({
      accountId: 'a1',
      date: '2026-03-01',
      valueUsd: 1300,
      contributedUsd: 1000,
      createdAt: '2026-03-01T00:00:00.000Z',
    });
    await syncInvestmentAccountToCloud(account(), '');
    await syncInvestmentSnapshotToCloud(snap(), '');
    expect(mockStore.size).toBe(1);
  });

  it('deletes the account and only that account\'s snapshots', async () => {
    seed('users/u1/investmentAccounts/a1', { name: 'TFSA' });
    seed('users/u1/investmentAccounts/a2', { name: 'Crypto' });
    seed('users/u1/investmentSnapshots/s1', { accountId: 'a1', valueUsd: 1 });
    seed('users/u1/investmentSnapshots/s2', { accountId: 'a1', valueUsd: 2 });
    seed('users/u1/investmentSnapshots/keep', { accountId: 'a2', valueUsd: 9 });
    await syncInvestmentAccountDeletionToCloud('a1', 'u1');
    expect(mockStore.has('users/u1/investmentAccounts/a1')).toBe(false);
    expect(mockStore.has('users/u1/investmentSnapshots/s1')).toBe(false);
    expect(mockStore.has('users/u1/investmentSnapshots/s2')).toBe(false);
    expect(mockStore.has('users/u1/investmentAccounts/a2')).toBe(true);
    expect(mockStore.has('users/u1/investmentSnapshots/keep')).toBe(true);
  });
});

describe('subscribeToInvestments', () => {
  it('returns null without a uid', () => {
    expect(subscribeToInvestments('')).toBeNull();
  });

  it('skips pending writes, remaps unknown kinds to other, upserts, deletes, and notifies', async () => {
    const unsub = subscribeToInvestments('u1');
    expect(unsub).toEqual(expect.any(Function));

    fireCollection('users/u1/investmentAccounts', [
      { type: 'modified', id: 'pending', data: { name: 'skip' }, hasPendingWrites: true },
      { type: 'added', id: 'a1', data: { name: 'Brokerage', kind: 'not-a-kind', contributedUsd: 10, valueUsd: 12 } },
      { type: 'removed', id: 'gone' },
    ]);
    await flush();

    expect(mockUpsertAccount).toHaveBeenCalledTimes(1);
    expect(mockUpsertAccount).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'a1', name: 'Brokerage', kind: 'other', contributedUsd: 10, valueUsd: 12 }),
      'u1',
    );
    expect(mockDeleteAccount).toHaveBeenCalledWith('gone', 'u1');
    expect(mockNotify).toHaveBeenCalled();
  });

  it('snapshot listener skips pending writes and applies remote add/remove', async () => {
    subscribeToInvestments('u1');
    fireCollection('users/u1/investmentSnapshots', [
      { type: 'added', id: 'local', data: { accountId: 'a1' }, hasPendingWrites: true },
      { type: 'added', id: 's1', data: { accountId: 'a1', date: '2026-04-01', valueUsd: 50, contributedUsd: 40 } },
      { type: 'removed', id: 'old' },
    ]);
    await flush();

    expect(mockUpsertSnap).toHaveBeenCalledTimes(1);
    expect(mockUpsertSnap).toHaveBeenCalledWith(
      expect.objectContaining({ id: 's1', accountId: 'a1', date: '2026-04-01', valueUsd: 50 }),
      'u1',
    );
    expect(mockDeleteSnap).toHaveBeenCalledWith('old', 'u1');
  });

  it('uploads only local holdings the cloud does not already have', async () => {
    seed('users/u1/investmentAccounts/cloud-a', { name: 'Already there' });
    seed('users/u1/investmentSnapshots/cloud-s', { accountId: 'cloud-a' });
    mockGetAccounts.mockResolvedValue([
      account({ id: 'cloud-a', name: 'Already there' }),
      account({ id: 'local-a', name: 'Phone only' }),
    ]);
    mockGetSnaps.mockResolvedValue([
      snap({ id: 'cloud-s' }),
      snap({ id: 'local-s', accountId: 'local-a' }),
    ]);

    subscribeToInvestments('u1');
    await flush();

    expect(mockStore.get('users/u1/investmentAccounts/local-a')).toEqual(
      expect.objectContaining({ name: 'Phone only' }),
    );
    expect(mockStore.get('users/u1/investmentSnapshots/local-s')).toEqual(
      expect.objectContaining({ accountId: 'local-a' }),
    );
    expect(mockStore.get('users/u1/investmentAccounts/cloud-a')).toEqual({ name: 'Already there' });
  });
});
