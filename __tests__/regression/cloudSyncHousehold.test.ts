/**
 * Household invite / membership / discovery-index paths in lib/cloudSync.ts.
 * UI tests mock these functions; the Firestore mutations themselves had no
 * direct coverage despite being the permission + join surface.
 */

type Stored = Record<string, unknown>;

const mockStore = new Map<string, Stored>();
let lastSnapshotHandler: ((snap: unknown) => Promise<void>) | undefined;
let autoId = 0;

function isOp(value: unknown): value is { __op: string; v?: unknown; n?: number } {
  return typeof value === 'object' && value !== null && '__op' in value;
}

function applyFields(existing: Stored | undefined, data: Stored, merge: boolean): Stored {
  const next: Stored = merge ? { ...(existing ?? {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    if (isOp(value) && value.__op === 'arrayUnion') {
      const arr = Array.isArray(next[key]) ? [...(next[key] as unknown[])] : [];
      const items = Array.isArray(value.v) ? value.v : [value.v];
      for (const item of items) {
        if (!arr.includes(item)) arr.push(item);
      }
      next[key] = arr;
    } else if (isOp(value) && value.__op === 'arrayRemove') {
      const arr = Array.isArray(next[key]) ? (next[key] as unknown[]) : [];
      const items = Array.isArray(value.v) ? value.v : [value.v];
      next[key] = arr.filter((item) => !items.includes(item));
    } else if (isOp(value) && value.__op === 'increment') {
      next[key] = (typeof next[key] === 'number' ? (next[key] as number) : 0) + (value.n ?? 0);
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
};

type DocRef = {
  path: string;
  id: string;
  get: jest.Mock;
  set: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
  collection: (name: string) => { doc: (id?: string) => DocRef; get: jest.Mock };
  onSnapshot: jest.Mock;
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
    onSnapshot: jest.fn((cb: (snap: unknown) => Promise<void>) => {
      lastSnapshotHandler = cb;
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
  };
}

const mockFirestoreFn = Object.assign(
  () => ({
    collection: (name: string) => makeCollection(name),
    batch: () => {
      const ops: Array<
        | { type: 'set'; path: string; data: Stored; merge: boolean }
        | { type: 'delete'; path: string }
      > = [];
      return {
        set: (ref: { path: string }, data: Stored, opts?: { merge?: boolean }) => {
          ops.push({ type: 'set', path: ref.path, data, merge: !!opts?.merge });
        },
        delete: (ref: { path: string }) => {
          ops.push({ type: 'delete', path: ref.path });
        },
        commit: jest.fn(async () => {
          for (const op of ops) {
            if (op.type === 'delete') mockStore.delete(op.path);
            else mockStore.set(op.path, applyFields(mockStore.get(op.path), op.data, op.merge));
          }
        }),
      };
    },
    runTransaction: async (fn: (tx: {
      get: (ref: { path: string }) => Promise<ReturnType<typeof makeSnap>>;
      set: (ref: { path: string }, data: Stored, opts?: { merge?: boolean }) => void;
      update: (ref: { path: string }, data: Stored) => void;
      delete: (ref: { path: string }) => void;
    }) => Promise<void>) => {
      const tx = {
        get: async (ref: { path: string }) => makeSnap(ref.path),
        set: (ref: { path: string }, data: Stored, opts?: { merge?: boolean }) => {
          mockStore.set(ref.path, applyFields(mockStore.get(ref.path), data, !!opts?.merge));
        },
        update: (ref: { path: string }, data: Stored) => {
          mockStore.set(ref.path, applyFields(mockStore.get(ref.path), data, true));
        },
        delete: (ref: { path: string }) => {
          mockStore.delete(ref.path);
        },
      };
      await fn(tx);
    },
  }),
  {
    FieldValue: {
      arrayUnion: (...v: unknown[]) => ({ __op: 'arrayUnion', v: v.length === 1 ? v[0] : v }),
      arrayRemove: (...v: unknown[]) => ({ __op: 'arrayRemove', v: v.length === 1 ? v[0] : v }),
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

const mockApplyBudgetsSnapshot = jest.fn();
const mockGetCloudMigrationDone = jest.fn();

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: (...args: unknown[]) => mockApplyBudgetsSnapshot(...args),
  getCloudMigrationDone: (...args: unknown[]) => mockGetCloudMigrationDone(...args),
  setCloudMigrationDone: jest.fn(),
}));

const mockApplyCustomCategories = jest.fn();
const mockClearPending = jest.fn(async () => undefined);
const mockGetPending = jest.fn(async () => ({ add: [] as unknown[], remove: [] as string[] }));

jest.mock('../../lib/customCategories', () => ({
  applyCustomCategories: (...args: unknown[]) => mockApplyCustomCategories(...args),
  clearPendingCustomCategoryChanges: (...args: unknown[]) => (mockClearPending as jest.Mock)(...args),
  getPendingCustomCategoryChanges: (...args: unknown[]) => (mockGetPending as jest.Mock)(...args),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

import {
  acceptInvite,
  acceptPhoneInviteIfAny,
  addHouseholdMemberByPhone,
  createHousehold,
  declineInvite,
  deleteHousehold,
  ensureHouseholdForUser,
  ensureMembershipForCurrentHousehold,
  getHouseholdMembers,
  getPendingInviteForEmail,
  getUserMemberships,
  inviteUserToHousehold,
  leaveHousehold,
  lookupUserByEmail,
  lookupUserByPhone,
  persistActiveHouseholdId,
  renameHousehold,
  setEmailIndex,
  setPhoneIndex,
  subscribeToHouseholdBudgets,
  syncCustomCategoriesToCloud,
  flushPendingCustomCategories,
  type PendingInvite,
} from '../../lib/cloudSync';

function seed(path: string, data: Stored) {
  mockStore.set(path, data);
}

function pendingInvite(overrides: Partial<PendingInvite> = {}): PendingInvite {
  return {
    email: 'invitee@example.com',
    householdId: 'hh-shared',
    householdName: 'The Smiths',
    invitedByUid: 'owner',
    invitedByName: 'Owner',
    invitedByEmail: 'owner@example.com',
    budgets: null,
    createdAt: '2026-09-26T12:00:00.000Z',
    expiresAt: '2026-09-28T12:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  mockStore.clear();
  lastSnapshotHandler = undefined;
  autoId = 0;
  jest.clearAllMocks();
  mockGetPending.mockResolvedValue({ add: [], remove: [] });
  mockApplyBudgetsSnapshot.mockResolvedValue(undefined);
  mockGetCloudMigrationDone.mockResolvedValue(false);
  jest.useFakeTimers();
  jest.setSystemTime(new Date('2026-09-27T12:00:00.000Z'));
});

afterEach(() => {
  jest.useRealTimers();
});

describe('inviteUserToHousehold', () => {
  it('rejects invalid email and missing household before writing', async () => {
    await expect(
      inviteUserToHousehold({
        email: 'not-an-email',
        householdId: 'hh1',
        invitedByUid: 'u1',
        invitedByEmail: 'a@b.com',
        invitedByName: 'A',
      }),
    ).resolves.toEqual({ ok: false, reason: 'invalid email' });

    await expect(
      inviteUserToHousehold({
        email: 'ok@example.com',
        householdId: '',
        invitedByUid: 'u1',
        invitedByEmail: null,
        invitedByName: null,
      }),
    ).resolves.toEqual({ ok: false, reason: 'no active household' });

    expect(mockStore.size).toBe(0);
  });

  it('writes a pending invite keyed by trimmed lowercase email', async () => {
    seed('households/hh1', { name: 'Nest', ownerUid: 'u1', memberUids: ['u1'] });

    const res = await inviteUserToHousehold({
      email: '  MixEd@Example.COM ',
      householdId: 'hh1',
      invitedByUid: 'u1',
      invitedByEmail: 'u1@example.com',
      invitedByName: 'Owner',
      budgets: { byCategory: { Groceries: 200 }, alertsEnabled: true },
    });

    expect(res).toEqual({ ok: true });
    const invite = mockStore.get('invites/mixed@example.com');
    expect(invite).toMatchObject({
      email: 'mixed@example.com',
      householdId: 'hh1',
      householdName: 'Nest',
      invitedByUid: 'u1',
      status: 'pending',
      budgets: { byCategory: { Groceries: 200 }, alertsEnabled: true },
    });
    expect(invite?.expiresAt).toEqual(new Date('2026-09-28T12:00:00.000Z'));
  });
});

describe('getPendingInviteForEmail', () => {
  it('returns null for a missing email or expired invite', async () => {
    await expect(getPendingInviteForEmail(null)).resolves.toBeNull();

    seed('invites/old@example.com', {
      email: 'old@example.com',
      householdId: 'hh1',
      expiresAt: '2026-09-26T00:00:00.000Z',
    });
    await expect(getPendingInviteForEmail('old@example.com')).resolves.toBeNull();
  });

  it('parses Timestamp-shaped expiresAt and createdAt', async () => {
    seed('invites/new@example.com', {
      email: 'new@example.com',
      householdId: 'hh1',
      householdName: 'Nest',
      invitedByUid: 'owner',
      invitedByName: 'Owner',
      invitedByEmail: 'owner@example.com',
      budgets: { byCategory: { Dining: 50 }, alertsEnabled: false },
      createdAt: { toDate: () => new Date('2026-09-27T01:00:00.000Z') },
      expiresAt: { toDate: () => new Date('2026-09-28T12:00:00.000Z') },
    });

    await expect(getPendingInviteForEmail('  New@Example.com ')).resolves.toEqual({
      email: 'new@example.com',
      householdId: 'hh1',
      householdName: 'Nest',
      invitedByUid: 'owner',
      invitedByName: 'Owner',
      invitedByEmail: 'owner@example.com',
      budgets: { byCategory: { Dining: 50 }, alertsEnabled: false },
      createdAt: '2026-09-27T01:00:00.000Z',
      expiresAt: '2026-09-28T12:00:00.000Z',
    });
  });
});

describe('acceptInvite / declineInvite', () => {
  it('joins the household, writes membership, and deletes the invite', async () => {
    seed('households/hh-shared', {
      ownerUid: 'owner',
      memberUids: ['owner'],
      memberCount: 1,
    });
    seed('invites/invitee@example.com', { status: 'pending' });

    const res = await acceptInvite({
      invite: pendingInvite({
        budgets: { byCategory: { Groceries: 100 }, alertsEnabled: true },
      }),
      uid: 'invitee',
    });

    expect(res).toEqual({ ok: true, newHouseholdId: 'hh-shared' });
    expect(mockStore.get('households/hh-shared')).toMatchObject({
      memberUids: ['owner', 'invitee'],
      memberCount: 2,
    });
    expect(mockStore.get('users/invitee')).toMatchObject({ householdId: 'hh-shared' });
    expect(mockStore.get('users/invitee/memberships/hh-shared')).toMatchObject({
      householdId: 'hh-shared',
      role: 'member',
      isDefault: false,
    });
    expect(mockStore.has('invites/invitee@example.com')).toBe(false);
    expect(mockApplyBudgetsSnapshot).toHaveBeenCalledWith('hh-shared', {
      byCategory: { Groceries: 100 },
      alertsEnabled: true,
    });
  });

  it('still reports a successful join when budget copy fails', async () => {
    seed('households/hh-shared', { ownerUid: 'owner', memberUids: ['owner'], memberCount: 1 });
    mockApplyBudgetsSnapshot.mockRejectedValue(new Error('secure store down'));

    const res = await acceptInvite({
      invite: pendingInvite({ budgets: { byCategory: { Groceries: 1 }, alertsEnabled: false } }),
      uid: 'invitee',
    });

    expect(res).toEqual({ ok: true, newHouseholdId: 'hh-shared' });
    expect(mockStore.get('users/invitee/memberships/hh-shared')).toBeDefined();
  });

  it('fails closed when the household doc is gone', async () => {
    const res = await acceptInvite({ invite: pendingInvite(), uid: 'invitee' });
    expect(res).toEqual({ ok: false, reason: 'household no longer exists' });
    expect(mockStore.has('users/invitee/memberships/hh-shared')).toBe(false);
  });

  it('declineInvite deletes only the invite doc', async () => {
    seed('invites/invitee@example.com', { status: 'pending' });
    seed('households/hh-shared', { memberUids: ['owner'] });

    await expect(declineInvite({ invite: pendingInvite() })).resolves.toEqual({ ok: true });
    expect(mockStore.has('invites/invitee@example.com')).toBe(false);
    expect(mockStore.has('households/hh-shared')).toBe(true);
  });
});

describe('discovery index', () => {
  it('setPhoneIndex without extra fields must not wipe displayName/pushToken', async () => {
    seed('phoneIndex/+14165551234', {
      uid: 'u1',
      displayName: 'Alice',
      pushToken: 'ExponentPushToken[abc]',
    });

    await setPhoneIndex('u1', '+14165551234');

    expect(mockStore.get('phoneIndex/+14165551234')).toMatchObject({
      uid: 'u1',
      displayName: 'Alice',
      pushToken: 'ExponentPushToken[abc]',
    });
  });

  it('setEmailIndex ignores invalid keys; lookup requires a uid', async () => {
    await setEmailIndex('u1', 'not-an-email');
    expect(mockStore.size).toBe(0);

    seed('emailIndex/ok@example.com', { displayName: 'No uid' });
    await expect(lookupUserByEmail('ok@example.com')).resolves.toBeNull();

    seed('emailIndex/ok@example.com', { uid: 'u2', displayName: 'Bob', pushToken: null });
    await expect(lookupUserByEmail('  OK@Example.com ')).resolves.toEqual({
      uid: 'u2',
      displayName: 'Bob',
      pushToken: null,
    });
  });

  it('lookupUserByPhone returns null when the pointer is missing', async () => {
    await expect(lookupUserByPhone('+14165550000')).resolves.toBeNull();
  });
});

describe('addHouseholdMemberByPhone / acceptPhoneInviteIfAny', () => {
  it('always writes phoneInvites and reports matched from phoneIndex', async () => {
    seed('households/hh1', { name: 'Nest' });
    seed('phoneIndex/+14165551234', { uid: 'u2', displayName: 'Bob', pushToken: 'tok' });

    const matched = await addHouseholdMemberByPhone({
      phoneE164: '+14165551234',
      householdId: 'hh1',
      invitedByUid: 'u1',
      invitedByName: 'Alice',
      budgets: { byCategory: { Groceries: 40 }, alertsEnabled: true },
    });
    expect(matched).toEqual({
      ok: true,
      matched: true,
      displayName: 'Bob',
      pushToken: 'tok',
    });
    expect(mockStore.get('phoneInvites/+14165551234')).toMatchObject({
      phone: '+14165551234',
      householdId: 'hh1',
      householdName: 'Nest',
      status: 'pending',
      budgets: { byCategory: { Groceries: 40 }, alertsEnabled: true },
    });

    mockStore.delete('phoneIndex/+14165559999');
    const unmatched = await addHouseholdMemberByPhone({
      phoneE164: '+14165559999',
      householdId: 'hh1',
      invitedByUid: 'u1',
      invitedByName: 'Alice',
    });
    expect(unmatched).toEqual({ ok: true, matched: false });
  });

  it('does not join when there is no invite or the invite is expired', async () => {
    await expect(acceptPhoneInviteIfAny('u2', '+14165550000')).resolves.toEqual({ joined: false });

    seed('phoneInvites/+14165550001', {
      householdId: 'hh1',
      expiresAt: '2026-09-26T00:00:00.000Z',
    });
    seed('households/hh1', { memberUids: ['u1'], memberCount: 1 });

    await expect(acceptPhoneInviteIfAny('u2', '+14165550001')).resolves.toEqual({ joined: false });
    expect(mockStore.has('phoneInvites/+14165550001')).toBe(false);
    expect(mockStore.get('households/hh1')).toMatchObject({ memberUids: ['u1'], memberCount: 1 });
  });

  it('self-joins, is idempotent if already a member, and applies budgets', async () => {
    seed('phoneInvites/+14165551234', {
      householdId: 'hh1',
      expiresAt: { toDate: () => new Date('2026-09-28T00:00:00.000Z') },
      budgets: { byCategory: { Dining: 25 }, alertsEnabled: true },
    });
    seed('households/hh1', { ownerUid: 'u1', memberUids: ['u1'], memberCount: 1 });

    await expect(acceptPhoneInviteIfAny('u2', '+14165551234')).resolves.toEqual({
      joined: true,
      householdId: 'hh1',
    });
    expect(mockStore.get('households/hh1')).toMatchObject({
      memberUids: ['u1', 'u2'],
      memberCount: 2,
    });
    expect(mockStore.get('users/u2/memberships/hh1')).toMatchObject({ role: 'member' });
    expect(mockStore.has('phoneInvites/+14165551234')).toBe(false);
    expect(mockApplyBudgetsSnapshot).toHaveBeenCalledWith('hh1', {
      byCategory: { Dining: 25 },
      alertsEnabled: true,
    });

    seed('phoneInvites/+14165551234', {
      householdId: 'hh1',
      expiresAt: '2026-09-28T00:00:00.000Z',
    });
    mockApplyBudgetsSnapshot.mockClear();

    await expect(acceptPhoneInviteIfAny('u2', '+14165551234')).resolves.toEqual({
      joined: true,
      householdId: 'hh1',
    });
    expect(mockStore.get('households/hh1')).toMatchObject({
      memberUids: ['u1', 'u2'],
      memberCount: 2,
    });
    expect(mockApplyBudgetsSnapshot).not.toHaveBeenCalled();
  });
});

describe('household lifecycle', () => {
  it('createHousehold / renameHousehold validate names', async () => {
    await expect(createHousehold({ uid: 'u1', name: '   ' })).resolves.toEqual({
      ok: false,
      reason: 'name required',
    });
    await expect(renameHousehold({ householdId: 'hh1', uid: 'u1', name: '' })).resolves.toEqual({
      ok: false,
      reason: 'name required',
    });

    const created = await createHousehold({ uid: 'u1', name: '  Family  ' });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(mockStore.get(`households/${created.householdId}`)).toMatchObject({
      ownerUid: 'u1',
      memberUids: ['u1'],
      memberCount: 1,
      name: 'Family',
    });
    expect(mockStore.get(`users/u1/memberships/${created.householdId}`)).toMatchObject({
      role: 'owner',
      isDefault: false,
    });

    seed('households/hh-rename', { ownerUid: 'u1' });
    await expect(
      renameHousehold({ householdId: 'hh-rename', uid: 'u1', name: '  New Name ' }),
    ).resolves.toEqual({ ok: true });
    expect(mockStore.get('households/hh-rename')).toMatchObject({ name: 'New Name' });
  });

  it('ensureHouseholdForUser returns the existing household and refreshes profile fields', async () => {
    seed('users/u1', { householdId: 'hh-old', email: null, displayName: null });

    await expect(
      ensureHouseholdForUser({ uid: 'u1', email: 'u1@example.com', displayName: 'Pat' }),
    ).resolves.toBe('hh-old');
    expect(mockStore.get('users/u1')).toMatchObject({
      householdId: 'hh-old',
      email: 'u1@example.com',
      displayName: 'Pat',
    });
  });

  it('ensureHouseholdForUser creates a solo household when none exists', async () => {
    const hid = await ensureHouseholdForUser({ uid: 'u9', email: 'u9@example.com' });
    expect(hid).toMatch(/^auto-\d+$/);
    expect(mockStore.get(`users/u9`)).toMatchObject({
      householdId: hid,
      email: 'u9@example.com',
    });
    expect(mockStore.get(`households/${hid}`)).toMatchObject({
      ownerUid: 'u9',
      memberUids: ['u9'],
      memberCount: 1,
    });
    expect(mockStore.has(`users/u9/memberships/${hid}`)).toBe(false);
  });

  it('ensureMembershipForCurrentHousehold is idempotent and stamps owner vs member', async () => {
    seed('households/hh1', { ownerUid: 'owner' });
    await ensureMembershipForCurrentHousehold('owner', 'hh1');
    expect(mockStore.get('users/owner/memberships/hh1')).toMatchObject({
      role: 'owner',
      isDefault: true,
    });

    mockStore.set('users/owner/memberships/hh1', { role: 'owner', isDefault: true, frozen: true });
    await ensureMembershipForCurrentHousehold('owner', 'hh1');
    expect(mockStore.get('users/owner/memberships/hh1')).toMatchObject({ frozen: true });

    await ensureMembershipForCurrentHousehold('member', 'hh1');
    expect(mockStore.get('users/member/memberships/hh1')).toMatchObject({ role: 'member' });
  });

  it('getUserMemberships drops dangling memberships and getHouseholdMembers labels owner/you', async () => {
    seed('users/u1/memberships/gone', { householdId: 'gone', role: 'member', isDefault: false });
    seed('users/u1/memberships/hh1', { householdId: 'hh1', role: 'member', isDefault: true });
    seed('households/hh1', { name: 'Nest', memberCount: 2, ownerUid: 'owner', memberUids: ['owner', 'u1'] });
    seed('users/owner', { email: 'owner@example.com', displayName: 'Owner' });
    seed('users/u1', { email: 'u1@example.com', displayName: 'You' });

    const memberships = await getUserMemberships('u1');
    expect(memberships).toEqual([
      {
        householdId: 'hh1',
        name: 'Nest',
        role: 'member',
        memberCount: 2,
        isDefault: true,
      },
    ]);
    expect(mockStore.has('users/u1/memberships/gone')).toBe(false);

    const members = await getHouseholdMembers({ householdId: 'hh1', currentUid: 'u1' });
    expect(members).toEqual([
      {
        uid: 'owner',
        email: 'owner@example.com',
        displayName: 'Owner',
        role: 'owner',
        isYou: false,
      },
      {
        uid: 'u1',
        email: 'u1@example.com',
        displayName: 'You',
        role: 'member',
        isYou: true,
      },
    ]);
    await expect(getHouseholdMembers({ householdId: 'missing', currentUid: 'u1' })).resolves.toEqual(
      [],
    );
  });

  it('leaveHousehold prefers the default remaining membership, else fabricates a solo household', async () => {
    seed('households/hh-leave', { ownerUid: 'owner', memberUids: ['owner', 'u1'], memberCount: 2 });
    seed('users/u1/memberships/hh-leave', { householdId: 'hh-leave' });
    seed('users/u1/memberships/hh-keep', { householdId: 'hh-keep', isDefault: true, role: 'member' });
    seed('users/u1/memberships/hh-other', { householdId: 'hh-other', isDefault: false, role: 'member' });
    seed('households/hh-keep', { name: 'Keep', memberCount: 1 });
    seed('households/hh-other', { name: 'Other', memberCount: 1 });

    const switched = await leaveHousehold({
      uid: 'u1',
      householdId: 'hh-leave',
      email: 'u1@example.com',
      displayName: 'You',
    });
    expect(switched).toEqual({ ok: true, nextActiveHouseholdId: 'hh-keep' });
    expect(mockStore.get('households/hh-leave')).toMatchObject({
      memberUids: ['owner'],
      memberCount: 1,
    });
    expect(mockStore.has('users/u1/memberships/hh-leave')).toBe(false);

    mockStore.clear();
    seed('households/hh-only', { ownerUid: 'u1', memberUids: ['u1'], memberCount: 1 });
    seed('users/u1', { householdId: 'hh-only' });
    seed('users/u1/memberships/hh-only', { householdId: 'hh-only', isDefault: true });

    const last = await leaveHousehold({
      uid: 'u1',
      householdId: 'hh-only',
      email: 'u1@example.com',
      displayName: 'You',
    });
    expect(last.ok).toBe(true);
    if (!last.ok) return;
    expect(last.nextActiveHouseholdId).toMatch(/^auto-\d+$/);
    expect(mockStore.get(`households/${last.nextActiveHouseholdId}`)).toMatchObject({
      ownerUid: 'u1',
      memberUids: ['u1'],
      memberCount: 1,
    });
    expect(mockStore.get(`users/u1/memberships/${last.nextActiveHouseholdId}`)).toMatchObject({
      role: 'owner',
      isDefault: true,
    });
  });

  it('leaveHousehold does not delete personal investment holdings', async () => {
    seed('households/hh-leave', { ownerUid: 'owner', memberUids: ['owner', 'u1'], memberCount: 2 });
    seed('users/u1/memberships/hh-leave', { householdId: 'hh-leave' });
    seed('users/u1/memberships/hh-keep', { householdId: 'hh-keep', isDefault: true, role: 'member' });
    seed('households/hh-keep', { name: 'Keep', memberCount: 1 });
    seed('users/u1/investmentAccounts/a1', { name: 'TFSA', kind: 'etf' });
    seed('users/u1/investmentSnapshots/s1', { accountId: 'a1', valueUsd: 1200 });

    await leaveHousehold({
      uid: 'u1',
      householdId: 'hh-leave',
      email: 'u1@example.com',
      displayName: 'You',
    });

    expect(mockStore.get('users/u1/investmentAccounts/a1')).toMatchObject({ name: 'TFSA' });
    expect(mockStore.get('users/u1/investmentSnapshots/s1')).toMatchObject({ accountId: 'a1' });
  });

  it('deleteHousehold is owner-only', async () => {
    seed('households/hh1', { ownerUid: 'owner', memberUids: ['owner', 'u1'] });
    await expect(deleteHousehold({ householdId: 'hh1', uid: 'u1' })).resolves.toEqual({
      ok: false,
      reason: 'only the owner can delete this household',
    });
    expect(mockStore.has('households/hh1')).toBe(true);

    await expect(deleteHousehold({ householdId: 'missing', uid: 'owner' })).resolves.toEqual({
      ok: false,
      reason: 'household no longer exists',
    });
  });

  it('deleteHousehold removes household collections but not the owner investment holdings', async () => {
    seed('households/hh1', { ownerUid: 'owner', memberUids: ['owner'] });
    seed('households/hh1/receipts/r1', { storeName: 'Costco' });
    seed('households/hh1/incomes/i1', { sourceName: 'Pay' });
    seed('households/hh1/savingsGoals/g1', { name: 'Holiday' });
    seed('households/hh1/settlements/s1', { amountUsd: 10 });
    seed('users/owner/memberships/hh1', { householdId: 'hh1' });
    seed('users/owner/investmentAccounts/a1', { name: 'RRSP' });
    seed('users/owner/investmentSnapshots/s1', { accountId: 'a1' });

    await expect(deleteHousehold({ householdId: 'hh1', uid: 'owner' })).resolves.toEqual({
      ok: true,
      receiptsDeleted: 1,
    });
    expect(mockStore.has('households/hh1')).toBe(false);
    expect(mockStore.has('households/hh1/receipts/r1')).toBe(false);
    expect(mockStore.has('households/hh1/incomes/i1')).toBe(false);
    expect(mockStore.has('households/hh1/savingsGoals/g1')).toBe(false);
    expect(mockStore.has('households/hh1/settlements/s1')).toBe(false);
    expect(mockStore.get('users/owner/investmentAccounts/a1')).toMatchObject({ name: 'RRSP' });
    expect(mockStore.get('users/owner/investmentSnapshots/s1')).toMatchObject({ accountId: 'a1' });
  });

  it('persistActiveHouseholdId merge-writes householdId', async () => {
    seed('users/u1', { email: 'u1@example.com', householdId: 'old' });
    await persistActiveHouseholdId('u1', 'new-hh');
    expect(mockStore.get('users/u1')).toMatchObject({
      email: 'u1@example.com',
      householdId: 'new-hh',
    });
  });
});

describe('custom category sync', () => {
  const pets = { name: 'Pets', color: '#D6336C' };
  const hobbies = { name: 'Hobbies', color: '#0CA678' };

  it('syncCustomCategoriesToCloud adds then removes on the household doc', async () => {
    seed('households/hh1', { memberUids: ['u1'] });
    await syncCustomCategoriesToCloud('hh1', { add: [pets, hobbies] });
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([pets, hobbies]);
    await syncCustomCategoriesToCloud('hh1', { remove: [pets] });
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([hobbies]);
    expect(mockStore.get('households/hh1')?.memberUids).toEqual(['u1']);
  });

  it('removal matches by name, clearing copies that differ only in color', async () => {
    seed('households/hh1', {
      memberUids: ['u1'],
      customCategories: [pets, { name: 'Pets', color: '#000000' }, hobbies],
    });
    await expect(syncCustomCategoriesToCloud('hh1', { remove: [pets] })).resolves.toBe(true);
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([hobbies]);
  });

  it('acknowledges pending changes only after a successful write', async () => {
    seed('households/hh1', { memberUids: ['u1'], customCategories: [pets] });
    await syncCustomCategoriesToCloud('hh1', { add: [hobbies] });
    expect(mockClearPending).toHaveBeenCalledWith('hh1', { add: ['Hobbies'], remove: undefined });
    mockClearPending.mockClear();
    await syncCustomCategoriesToCloud('hh1', { remove: [pets] });
    expect(mockClearPending).toHaveBeenCalledWith('hh1', { add: undefined, remove: ['Pets'] });
    mockClearPending.mockClear();
    await syncCustomCategoriesToCloud('', { add: [pets] });
    expect(mockClearPending).not.toHaveBeenCalled();
  });

  it('flushPendingCustomCategories re-sends unacknowledged adds and removes', async () => {
    seed('households/hh1', { memberUids: ['u1'], customCategories: [pets] });
    mockGetPending.mockResolvedValue({ add: [hobbies], remove: ['Pets'] });
    await flushPendingCustomCategories('hh1');
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([hobbies]);
    expect(mockClearPending).toHaveBeenCalledTimes(2);
  });

  it('starting the listener flushes pending changes', async () => {
    seed('households/hh1', { memberUids: ['u1'], customCategories: [] });
    mockGetPending.mockResolvedValue({ add: [pets], remove: [] });
    subscribeToHouseholdBudgets('hh1');
    for (let i = 0; i < 20; i += 1) await Promise.resolve();
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([pets]);
  });

  it('resolves false without a household id and true on success', async () => {
    seed('households/hh1', { memberUids: ['u1'] });
    await expect(syncCustomCategoriesToCloud('', { add: [pets] })).resolves.toBe(false);
    await expect(syncCustomCategoriesToCloud('hh1', { add: [pets] })).resolves.toBe(true);
  });

  it('is a no-op for an empty change or missing household id', async () => {
    seed('households/hh1', { memberUids: ['u1'] });
    await syncCustomCategoriesToCloud('hh1', {});
    await syncCustomCategoriesToCloud('', { add: [pets] });
    expect(mockStore.get('households/hh1')?.customCategories).toBeUndefined();
  });

  type SnapHandler = (snap: unknown) => Promise<void>;
  const snap = (data: Stored, opts: { pending?: boolean; exists?: boolean } = {}) => ({
    exists: opts.exists ?? true,
    metadata: { hasPendingWrites: opts.pending ?? false },
    data: () => data,
  });

  it('listener applies household custom categories even when no budgets are set', async () => {
    subscribeToHouseholdBudgets('hh1');
    await lastSnapshotHandler!(snap({ customCategories: [pets] }));
    expect(mockApplyCustomCategories).toHaveBeenCalledWith('hh1', [pets]);
    expect(mockApplyBudgetsSnapshot).not.toHaveBeenCalled();
  });

  it('listener applies budgets and custom categories together', async () => {
    subscribeToHouseholdBudgets('hh1');
    const budgets = { byCategory: { Pets: 20 }, alertsEnabled: true };
    await lastSnapshotHandler!(snap({ budgets, customCategories: [pets, hobbies] }));
    expect(mockApplyBudgetsSnapshot).toHaveBeenCalledWith('hh1', budgets);
    expect(mockApplyCustomCategories).toHaveBeenCalledWith('hh1', [pets, hobbies]);
  });

  it('listener ignores own pending writes, missing docs, and docs with neither field', async () => {
    subscribeToHouseholdBudgets('hh1');
    const h = lastSnapshotHandler as SnapHandler;
    await h(snap({ customCategories: [pets] }, { pending: true }));
    await h(snap({}, { exists: false }));
    await h(snap({ memberUids: ['u1'] }));
    expect(mockApplyCustomCategories).not.toHaveBeenCalled();
    expect(mockApplyBudgetsSnapshot).not.toHaveBeenCalled();
  });
});
