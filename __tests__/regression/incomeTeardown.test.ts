/**
 * Household / account teardown must delete incomes. Firestore does not
 * cascade subcollections when the parent household doc is removed, and
 * rules then block any later cleanup.
 */

type DocSnap = { id: string; exists: boolean; data: () => Record<string, unknown>; ref: { delete: jest.Mock; path: string } };

const mockStore = new Map<string, Record<string, unknown>>();
const mockDeletedPaths: string[] = [];
const mockBatchCommits: string[][] = [];

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
      mockStore.set(path, { ...(mockStore.get(path) ?? {}), ...data });
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

  it('always wipes this user\'s investment holdings, even when the household is shared', async () => {
    // Holdings live under users/{uid}, not the household. Deleting the
    // user doc does not cascade subcollections, so account deletion
    // must clear them first or they stay readable only by a gone uid.
    seedHousehold('h1', 'owner', ['owner', 'u1']);
    seedDoc('users/u1/investmentAccounts/a1', { name: 'TFSA' });
    seedDoc('users/u1/investmentSnapshots/s1', { accountId: 'a1', valueUsd: 1200 });
    seedDoc('users/u2/investmentAccounts/a2', { name: 'RRSP' });
    seedDoc('users/u2/investmentSnapshots/s2', { accountId: 'a2', valueUsd: 500 });
    seedDoc('users/u1', { householdId: 'h1' });

    const res = await deleteCloudUserData({ uid: 'u1', householdId: 'h1', email: null });
    expect(res.soloHouseholdDeleted).toBe(false);
    expect(mockStore.has('users/u1/investmentAccounts/a1')).toBe(false);
    expect(mockStore.has('users/u1/investmentSnapshots/s1')).toBe(false);
    expect(mockStore.has('users/u1')).toBe(false);
    expect(mockStore.has('users/u2/investmentAccounts/a2')).toBe(true);
    expect(mockStore.has('users/u2/investmentSnapshots/s2')).toBe(true);
  });

  it('clears discovery-index pointers and a pending email invite so contacts cannot resolve a deleted account', async () => {
    seedHousehold('h1', 'u1', ['u1']);
    seedDoc('emailIndex/jane@example.com', { uid: 'u1', displayName: 'Jane' });
    seedDoc('phoneIndex/+14165551234', { uid: 'u1' });
    seedDoc('invites/jane@example.com', { householdId: 'other', status: 'pending' });
    seedDoc('users/u1', { householdId: 'h1' });

    await deleteCloudUserData({
      uid: 'u1',
      householdId: 'h1',
      email: 'Jane@Example.com',
      phoneE164: '+14165551234',
    });

    await Promise.resolve();
    await Promise.resolve();

    expect(mockStore.has('emailIndex/jane@example.com')).toBe(false);
    expect(mockStore.has('phoneIndex/+14165551234')).toBe(false);
    expect(mockStore.has('invites/jane@example.com')).toBe(false);
  });
});
