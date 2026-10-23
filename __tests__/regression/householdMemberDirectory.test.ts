/**
 * Member-directory contracts in lib/cloudSync.ts.
 *
 * Settings, Home, Balances, and split pickers all call getHouseholdMembers.
 * memberUids on the household doc is the source of truth; a missing or
 * unreadable users/{uid} profile must not drop that person from the panel
 * (or abort the whole list). First-sign-in bootstrap also must not write
 * households/{hid}/members/{uid} in the same batch as the household create
 * — the members rule get()s the parent doc, which is empty pre-commit.
 */

type Stored = Record<string, unknown>;

const mockStore = new Map<string, Stored>();
const throwOnGet = new Set<string>();
let autoId = 0;

type DocSnap = {
  exists: boolean;
  data: () => Stored;
  id: string;
  ref: DocRef;
};

type DocRef = {
  path: string;
  id: string;
  get: jest.Mock;
  set: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  collection: (name: string) => { doc: (id?: string) => DocRef; get: jest.Mock };
};

function makeSnap(path: string): DocSnap {
  const data = mockStore.get(path);
  return {
    exists: data !== undefined,
    data: () => data ?? {},
    id: path.split('/').pop() ?? path,
    ref: makeRef(path),
  };
}

function applyFields(existing: Stored | undefined, data: Stored, merge: boolean): Stored {
  const next: Stored = merge ? { ...(existing ?? {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    next[key] = value;
  }
  return next;
}

function makeRef(path: string): DocRef {
  return {
    path,
    id: path.split('/').pop() ?? path,
    get: jest.fn(async () => {
      if (throwOnGet.has(path)) throw new Error('permission-denied');
      return makeSnap(path);
    }),
    set: jest.fn(async (data: Stored, opts?: { merge?: boolean }) => {
      mockStore.set(path, applyFields(mockStore.get(path), data, !!opts?.merge));
    }),
    update: jest.fn(),
    delete: jest.fn(),
    collection: (name: string) => makeCollection(`${path}/${name}`),
  };
}

function makeCollection(path: string) {
  return {
    doc: (id?: string) => {
      const docId = id ?? `auto-${++autoId}`;
      return makeRef(`${path}/${docId}`);
    },
    get: jest.fn(async () => ({ docs: [] })),
  };
}

const mockFirestoreFn = Object.assign(
  () => ({
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const ops: Array<{ path: string; data: Stored; merge: boolean }> = [];
      return {
        set: (ref: { path: string }, data: Stored, opts?: { merge?: boolean }) => {
          ops.push({ path: ref.path, data, merge: !!opts?.merge });
        },
        delete: jest.fn(),
        commit: jest.fn(async () => {
          for (const op of ops) {
            mockStore.set(op.path, applyFields(mockStore.get(op.path), op.data, op.merge));
          }
        }),
      };
    },
    runTransaction: jest.fn(),
  }),
  {
    FieldValue: {
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

jest.mock('../../lib/customCategories', () => ({
  applyCustomCategories: jest.fn(),
  clearPendingCustomCategoryChanges: jest.fn(),
  getPendingCustomCategoryChanges: jest.fn(async () => ({ add: [], remove: [] })),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

import {
  ensureHouseholdForUser,
  getHouseholdMembers,
} from '../../lib/cloudSync';

function seed(path: string, data: Stored) {
  mockStore.set(path, data);
}

beforeEach(() => {
  mockStore.clear();
  throwOnGet.clear();
  autoId = 0;
});

describe('getHouseholdMembers', () => {
  it('returns null when there is no household id (callers treat that as unavailable, not empty)', async () => {
    await expect(getHouseholdMembers({ householdId: '', currentUid: 'u1' })).resolves.toBeNull();
  });

  it('returns an empty list when the household doc is missing', async () => {
    await expect(getHouseholdMembers({ householdId: 'gone', currentUid: 'u1' })).resolves.toEqual([]);
  });

  it('lists every memberUids entry even when the user profile doc is missing', async () => {
    seed('households/hh1', { ownerUid: 'owner', memberUids: ['owner', 'u2'] });
    seed('users/owner', { email: 'owner@example.com', displayName: 'Pat' });

    await expect(getHouseholdMembers({ householdId: 'hh1', currentUid: 'u2' })).resolves.toEqual([
      {
        uid: 'owner',
        email: 'owner@example.com',
        displayName: 'Pat',
        role: 'owner',
        isYou: false,
      },
      {
        uid: 'u2',
        email: null,
        displayName: null,
        role: 'member',
        isYou: true,
      },
    ]);
  });

  it('stubs a member whose user-doc read fails instead of dropping them or failing the list', async () => {
    seed('households/hh1', { ownerUid: 'owner', memberUids: ['owner', 'u2'] });
    seed('users/owner', { email: 'owner@example.com', displayName: 'Pat' });
    seed('users/u2', { email: 'u2@example.com', displayName: 'You' });
    throwOnGet.add('users/u2');

    const members = await getHouseholdMembers({ householdId: 'hh1', currentUid: 'u2' });
    expect(members).toEqual([
      {
        uid: 'owner',
        email: 'owner@example.com',
        displayName: 'Pat',
        role: 'owner',
        isYou: false,
      },
      {
        uid: 'u2',
        email: null,
        displayName: null,
        role: 'member',
        isYou: true,
      },
    ]);
  });

  it('returns null (not []) when the household read itself fails', async () => {
    seed('households/hh1', { ownerUid: 'owner', memberUids: ['owner'] });
    throwOnGet.add('households/hh1');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(getHouseholdMembers({ householdId: 'hh1', currentUid: 'owner' })).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('ensureHouseholdForUser members subcollection', () => {
  it('creates the household without a members/{uid} doc in the same batch', async () => {
    const hid = await ensureHouseholdForUser({ uid: 'u9', email: 'u9@example.com' });
    expect(hid).toMatch(/^auto-\d+$/);
    expect(mockStore.get(`households/${hid}`)).toMatchObject({
      ownerUid: 'u9',
      memberUids: ['u9'],
      memberCount: 1,
    });
    const memberDocs = [...mockStore.keys()].filter((k) => k.startsWith(`households/${hid}/members/`));
    expect(memberDocs).toEqual([]);
  });
});
