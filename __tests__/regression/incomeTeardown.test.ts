/**
 * Household / account teardown must delete incomes. Firestore does not
 * cascade subcollections when the parent household doc is removed, and
 * rules then block any later cleanup.
 */

type DocSnap = { id: string; exists: boolean; data: () => Record<string, unknown>; ref: { delete: jest.Mock; path: string } };

const mockStore = new Map<string, Record<string, unknown>>();
const mockDeletedPaths: string[] = [];
const mockBatchCommits: string[][] = [];
const throwOnUpdate = new Set<string>();

function makeRef(path: string) {
  return {
    path,
    get: jest.fn(async () => {
      const data = mockStore.get(path);
      return {
        exists: data !== undefined,
        data: () => data ?? {},
        id: path.split('/').pop() ?? path,
      };
    }),
    set: jest.fn(async (data: Record<string, unknown>) => {
      mockStore.set(path, data);
    }),
    update: jest.fn(async (data: Record<string, unknown>) => {
      if (throwOnUpdate.has(path)) {
        throwOnUpdate.delete(path);
        throw new Error('permission-denied');
      }
      const current = { ...(mockStore.get(path) ?? {}) };
      for (const [key, value] of Object.entries(data)) {
        if (value && typeof value === 'object' && '__op' in (value as object)) {
          const op = value as { __op: string; v?: string; n?: number };
          if (op.__op === 'arrayRemove') {
            const arr = Array.isArray(current[key]) ? [...(current[key] as string[])] : [];
            current[key] = arr.filter((item) => item !== op.v);
          } else if (op.__op === 'increment') {
            current[key] = Number(current[key] ?? 0) + (op.n ?? 0);
          } else if (op.__op === 'serverTimestamp') {
            current[key] = 'server-ts';
          }
        } else {
          current[key] = value;
        }
      }
      mockStore.set(path, current);
    }),
    delete: jest.fn(async () => {
      mockStore.delete(path);
      mockDeletedPaths.push(path);
    }),
    collection: (name: string) => makeCollection(`${path}/${name}`),
  };
}

function makeCollection(path: string) {
  return {
    doc: (id: string) => makeRef(`${path}/${id}`),
    get: jest.fn(async () => {
      const prefix = `${path}/`;
      const docs: DocSnap[] = [];
      for (const [key] of mockStore) {
        if (!key.startsWith(prefix)) continue;
        const rest = key.slice(prefix.length);
        if (rest.includes('/')) continue;
        docs.push({
          id: rest,
          exists: true,
          data: () => mockStore.get(key) ?? {},
          ref: makeRef(key),
        });
      }
      return { docs };
    }),
  };
}

const mockFirestoreFn = Object.assign(
  () => ({
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const ops: string[] = [];
      return {
        delete: (ref: { path: string; delete: () => Promise<void> }) => {
          ops.push(ref.path);
        },
        commit: jest.fn(async () => {
          mockBatchCommits.push([...ops]);
          for (const p of ops) {
            mockStore.delete(p);
            mockDeletedPaths.push(p);
          }
        }),
      };
    },
  }),
  {
    FieldValue: {
      arrayRemove: (v: string) => ({ __op: 'arrayRemove', v }),
      increment: (n: number) => ({ __op: 'increment', n }),
      serverTimestamp: () => ({ __op: 'serverTimestamp' }),
    },
  },
);

jest.mock('@react-native-firebase/firestore', () => ({
  default: mockFirestoreFn,
}));

jest.mock('@react-native-firebase/storage', () => ({
  default: null,
}));

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: jest.fn(),
  getCloudMigrationDone: jest.fn(),
  setCloudMigrationDone: jest.fn(),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

import { deleteCloudUserData, deleteHousehold } from '../../lib/cloudSync';

function seedHousehold(hid: string, ownerUid: string, memberUids: string[]) {
  mockStore.set(`households/${hid}`, { ownerUid, memberUids, memberCount: memberUids.length });
}

function seedDoc(path: string, data: Record<string, unknown> = {}) {
  mockStore.set(path, data);
}

beforeEach(() => {
  mockStore.clear();
  mockDeletedPaths.length = 0;
  mockBatchCommits.length = 0;
  throwOnUpdate.clear();
});

describe('deleteHousehold', () => {
  it('deletes incomes before the household document', async () => {
    seedHousehold('h1', 'owner', ['owner']);
    seedDoc('households/h1/receipts/r1', { merchant: 'Cafe' });
    seedDoc('households/h1/settlements/s1', { amountUsd: 10 });
    seedDoc('households/h1/incomes/i1', { sourceName: 'Acme', amountUsd: 3200, notes: 'biweekly' });
    seedDoc('households/h1/savingsGoals/g1', { name: 'Emergency', targetUsd: 1000 });
    seedDoc('users/owner/memberships/h1', { householdId: 'h1' });

    const res = await deleteHousehold({ householdId: 'h1', uid: 'owner' });
    expect(res).toEqual({ ok: true, receiptsDeleted: 1 });
    expect(mockStore.has('households/h1/incomes/i1')).toBe(false);
    expect(mockStore.has('households/h1/savingsGoals/g1')).toBe(false);
    expect(mockStore.has('households/h1')).toBe(false);
    expect(mockDeletedPaths.indexOf('households/h1/incomes/i1')).toBeGreaterThan(-1);
    expect(mockDeletedPaths.indexOf('households/h1/incomes/i1')).toBeLessThan(
      mockDeletedPaths.indexOf('households/h1'),
    );
    expect(mockDeletedPaths.indexOf('households/h1/savingsGoals/g1')).toBeGreaterThan(-1);
    expect(mockDeletedPaths.indexOf('households/h1/savingsGoals/g1')).toBeLessThan(
      mockDeletedPaths.indexOf('households/h1'),
    );
  });
});

describe('deleteCloudUserData', () => {
  it('wipes incomes when the household is solo', async () => {
    seedHousehold('h1', 'u1', ['u1']);
    seedDoc('households/h1/receipts/r1', {});
    seedDoc('households/h1/incomes/i1', { sourceName: 'Payroll', notes: 'direct deposit' });
    seedDoc('households/h1/savingsGoals/g1', { name: 'Emergency' });
    seedDoc('users/u1', { householdId: 'h1' });

    const res = await deleteCloudUserData({ uid: 'u1', householdId: 'h1', email: null });
    expect(res.soloHouseholdDeleted).toBe(true);
    expect(mockStore.has('households/h1/incomes/i1')).toBe(false);
    expect(mockStore.has('households/h1/savingsGoals/g1')).toBe(false);
    expect(mockStore.has('households/h1')).toBe(false);
  });

  it('leaves incomes when leaving a shared household', async () => {
    seedHousehold('h1', 'owner', ['owner', 'u1']);
    seedDoc('households/h1/incomes/i1', { sourceName: 'Shared paycheck' });
    seedDoc('households/h1/savingsGoals/g1', { name: 'Shared envelope' });

    const res = await deleteCloudUserData({ uid: 'u1', householdId: 'h1', email: null });
    expect(res.soloHouseholdDeleted).toBe(false);
    expect(mockStore.has('households/h1/incomes/i1')).toBe(true);
    expect(mockStore.has('households/h1/savingsGoals/g1')).toBe(true);
    expect(mockStore.has('households/h1')).toBe(true);
  });

  it('removes the deleted uid from a shared household without wiping shared data', async () => {
    seedHousehold('h1', 'owner', ['owner', 'u1']);
    seedDoc('households/h1/receipts/r1', { merchant: 'Shared cafe' });
    seedDoc('households/h1/incomes/i1', { sourceName: 'Shared paycheck' });
    seedDoc('households/h1/savingsGoals/g1', { name: 'Shared envelope' });
    seedDoc('users/u1', { householdId: 'h1' });
    seedDoc('users/owner', { householdId: 'h1' });
    seedDoc('users/owner/investmentAccounts/a1', { name: 'Owner 401k' });
    seedDoc('users/u1/investmentAccounts/a2', { name: 'Leaver brokerage' });

    const res = await deleteCloudUserData({ uid: 'u1', householdId: 'h1', email: null });

    expect(res).toEqual({ receiptsDeleted: 0, soloHouseholdDeleted: false });
    expect(mockStore.get('households/h1')).toMatchObject({
      ownerUid: 'owner',
      memberUids: ['owner'],
      memberCount: 1,
    });
    expect(mockStore.has('households/h1/receipts/r1')).toBe(true);
    expect(mockStore.has('households/h1/incomes/i1')).toBe(true);
    expect(mockStore.has('households/h1/savingsGoals/g1')).toBe(true);
    expect(mockStore.has('users/u1')).toBe(false);
    expect(mockStore.has('users/u1/investmentAccounts/a2')).toBe(false);
    expect(mockStore.has('users/owner')).toBe(true);
    expect(mockStore.has('users/owner/investmentAccounts/a1')).toBe(true);
  });

  it('still deletes the user doc when the household is already gone', async () => {
    seedDoc('users/u1', { householdId: 'missing' });

    const res = await deleteCloudUserData({ uid: 'u1', householdId: 'missing', email: null });

    expect(res.soloHouseholdDeleted).toBe(false);
    expect(mockStore.has('users/u1')).toBe(false);
  });

  it('still deletes the user doc when the shared membership update fails', async () => {
    seedHousehold('h1', 'owner', ['owner', 'u1']);
    seedDoc('users/u1', { householdId: 'h1' });
    throwOnUpdate.add('households/h1');

    const res = await deleteCloudUserData({ uid: 'u1', householdId: 'h1', email: null });

    expect(res.soloHouseholdDeleted).toBe(false);
    expect(mockStore.has('users/u1')).toBe(false);
    expect(mockStore.has('households/h1')).toBe(true);
    expect(mockStore.get('households/h1')).toMatchObject({
      memberUids: ['owner', 'u1'],
      memberCount: 2,
    });
  });
});
