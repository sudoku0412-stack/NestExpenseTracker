/**
 * Premium custom categories shadow-write onto the household doc via
 * arrayUnion / name-based rewrite (not a whole-list overwrite), so two
 * members editing at once cannot clobber each other or resurrect a
 * removed name that another member created with a different color.
 */

type Stored = Record<string, unknown>;

const mockStore = new Map<string, Stored>();

function isOp(value: unknown): value is { __op: string; v?: unknown } {
  return typeof value === 'object' && value !== null && '__op' in value;
}

function applyFields(existing: Stored | undefined, data: Stored, merge: boolean): Stored {
  const next: Stored = merge ? { ...(existing ?? {}) } : {};
  for (const [key, value] of Object.entries(data)) {
    if (isOp(value) && value.__op === 'arrayUnion') {
      const arr = Array.isArray(next[key]) ? [...(next[key] as unknown[])] : [];
      const items = Array.isArray(value.v) ? value.v : [value.v];
      for (const item of items) arr.push(item);
      next[key] = arr;
    } else {
      next[key] = value;
    }
  }
  return next;
}

type DocRef = {
  path: string;
  get: jest.Mock;
  set: jest.Mock;
};

function makeSnap(path: string) {
  const data = mockStore.get(path);
  return { exists: data !== undefined, data: () => data ?? {}, id: path.split('/').pop() ?? path };
}

function makeRef(path: string): DocRef {
  return {
    path,
    get: jest.fn(async () => makeSnap(path)),
    set: jest.fn(async (data: Stored, opts?: { merge?: boolean }) => {
      mockStore.set(path, applyFields(mockStore.get(path), data, !!opts?.merge));
    }),
  };
}

function makeCollection(path: string) {
  return {
    doc: (id: string) => makeRef(`${path}/${id}`),
  };
}

const mockFirestoreFn = Object.assign(
  () => ({
    collection: (name: string) => makeCollection(name),
  }),
  {
    FieldValue: {
      arrayUnion: (...v: unknown[]) => ({ __op: 'arrayUnion', v: v.length === 1 ? v[0] : v }),
    },
  },
);

jest.mock('@react-native-firebase/firestore', () => ({
  default: mockFirestoreFn,
}));

jest.mock('@react-native-firebase/storage', () => ({
  default: null,
}));

const mockSecureStore = new Map<string, string>();
jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => mockSecureStore.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    mockSecureStore.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    mockSecureStore.delete(k);
  }),
}));

jest.mock('../../lib/secureStorage', () => ({
  applyBudgetsSnapshot: jest.fn(),
  getCloudMigrationDone: jest.fn(),
  setCloudMigrationDone: jest.fn(),
}));

jest.mock('../../lib/dataSync', () => ({
  notifyLocalDataChanged: jest.fn(),
}));

import {
  flushPendingCustomCategories,
  syncCustomCategoriesToCloud,
} from '../../lib/cloudSync';
import {
  addCustomCategory,
  applyCustomCategories,
  getCustomCategories,
  getPendingCustomCategoryChanges,
  removeCustomCategory,
} from '../../lib/customCategories';

beforeEach(async () => {
  mockStore.clear();
  mockSecureStore.clear();
  await getCustomCategories('__reset__');
});

describe('syncCustomCategoriesToCloud', () => {
  it('returns false when householdId is missing', async () => {
    expect(await syncCustomCategoriesToCloud('', { add: [{ name: 'Pets', color: '#111' }] })).toBe(false);
    expect(mockStore.size).toBe(0);
  });

  it('arrayUnions adds without wiping other household fields', async () => {
    mockStore.set('households/hh1', { ownerUid: 'u1', memberUids: ['u1', 'u2'] });
    const ok = await syncCustomCategoriesToCloud('hh1', {
      add: [
        { name: 'Pets', color: '#111' },
        { name: 'Hobbies', color: '#222' },
      ],
    });
    expect(ok).toBe(true);
    expect(mockStore.get('households/hh1')).toEqual({
      ownerUid: 'u1',
      memberUids: ['u1', 'u2'],
      customCategories: [
        { name: 'Pets', color: '#111' },
        { name: 'Hobbies', color: '#222' },
      ],
    });
  });

  it('removes every copy of a name even when the color differs, and leaves other names', async () => {
    mockStore.set('households/hh1', {
      memberUids: ['u1'],
      customCategories: [
        { name: 'Pets', color: '#aaa' },
        { name: 'Hobbies', color: '#222' },
        { name: 'Pets', color: '#bbb' },
      ],
    });
    const ok = await syncCustomCategoriesToCloud('hh1', {
      remove: [{ name: 'Pets', color: '#999' }],
    });
    expect(ok).toBe(true);
    expect(mockStore.get('households/hh1')).toEqual({
      memberUids: ['u1'],
      customCategories: [{ name: 'Hobbies', color: '#222' }],
    });
  });

  it('acknowledges pending local adds so a later snapshot cannot resurrect a dropped name', async () => {
    const added = await addCustomCategory('hh1', 'Pets');
    expect(added.ok).toBe(true);
    expect((await getPendingCustomCategoryChanges('hh1')).add.map((c) => c.name)).toEqual(['Pets']);

    await syncCustomCategoriesToCloud('hh1', { add: [{ name: 'Pets', color: '#111' }] });
    expect(await getPendingCustomCategoryChanges('hh1')).toEqual({ add: [], remove: [] });
  });
});

describe('flushPendingCustomCategories', () => {
  it('replays a pending add onto the household doc', async () => {
    mockStore.set('households/hh1', { ownerUid: 'u1' });
    const added = await addCustomCategory('hh1', 'Pets');
    expect(added.ok).toBe(true);
    await flushPendingCustomCategories('hh1');
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([
      expect.objectContaining({ name: 'Pets' }),
    ]);
    expect((await getPendingCustomCategoryChanges('hh1')).add).toEqual([]);
  });

  it('replays a pending remove by name even with an empty color', async () => {
    mockStore.set('households/hh1', {
      customCategories: [
        { name: 'Pets', color: '#111' },
        { name: 'Hobbies', color: '#222' },
      ],
    });
    await applyCustomCategories('hh1', [
      { name: 'Pets', color: '#111' },
      { name: 'Hobbies', color: '#222' },
    ]);
    await removeCustomCategory('hh1', 'Pets');
    expect((await getPendingCustomCategoryChanges('hh1')).remove).toEqual(['Pets']);
    await flushPendingCustomCategories('hh1');
    expect(mockStore.get('households/hh1')?.customCategories).toEqual([{ name: 'Hobbies', color: '#222' }]);
    expect((await getPendingCustomCategoryChanges('hh1')).remove).toEqual([]);
  });
});
