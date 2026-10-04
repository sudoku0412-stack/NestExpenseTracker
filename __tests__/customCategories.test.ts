const store = new Map<string, string>();

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
  setItemAsync: jest.fn(async (k: string, v: string) => {
    store.set(k, v);
  }),
  deleteItemAsync: jest.fn(async (k: string) => {
    store.delete(k);
  }),
}));

import {
  CUSTOM_CATEGORY_COLORS,
  MAX_CUSTOM_CATEGORIES,
  MAX_CUSTOM_CATEGORY_NAME,
  addCustomCategory,
  applyCustomCategories,
  clearPendingCustomCategoryChanges,
  getPendingCustomCategoryChanges,
  clearCustomCategoriesForHousehold,
  getCustomCategories,
  getCustomCategoriesSynced,
  setCustomCategoriesSynced,
  removeCustomCategory,
  resolveCategoryColor,
  cachedCustomCategories,
} from '../lib/customCategories';

beforeEach(async () => {
  store.clear();
  // lastLoaded is process-global; an empty household read resets it so
  // tests do not leak the previous case's palette into list-row lookups.
  await getCustomCategories('__reset__');
});

describe('addCustomCategory', () => {
  it('trims, collapses whitespace, persists, and assigns a palette color', async () => {
    const r = await addCustomCategory('h1', '  Pet   Care ');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.added).toEqual({ name: 'Pet Care', color: CUSTOM_CATEGORY_COLORS[0] });
    expect(await getCustomCategories('h1')).toEqual([r.added]);
  });

  it('cycles palette colors as more are added', async () => {
    await addCustomCategory('h1', 'A');
    const r = await addCustomCategory('h1', 'B');
    expect(r.ok && r.added.color).toBe(CUSTOM_CATEGORY_COLORS[1]);
  });

  it('rejects empty, too-long, built-in (any case), Recurring, and duplicate names', async () => {
    expect(await addCustomCategory('h1', '   ')).toEqual({ ok: false, reason: 'empty' });
    expect(await addCustomCategory('h1', 'x'.repeat(MAX_CUSTOM_CATEGORY_NAME + 1))).toEqual({
      ok: false,
      reason: 'tooLong',
    });
    expect(await addCustomCategory('h1', 'groceries')).toEqual({ ok: false, reason: 'duplicate' });
    expect(await addCustomCategory('h1', 'Recurring')).toEqual({ ok: false, reason: 'duplicate' });
    await addCustomCategory('h1', 'Pets');
    expect(await addCustomCategory('h1', 'pets')).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('enforces the per-household limit', async () => {
    for (let i = 0; i < MAX_CUSTOM_CATEGORIES; i += 1) {
      expect((await addCustomCategory('h1', `Cat ${i}`)).ok).toBe(true);
    }
    expect(await addCustomCategory('h1', 'One too many')).toEqual({ ok: false, reason: 'limit' });
  });

  it('keeps households isolated', async () => {
    await addCustomCategory('h1', 'Pets');
    expect(await getCustomCategories('h2')).toEqual([]);
    expect((await addCustomCategory('h2', 'Pets')).ok).toBe(true);
  });
});

describe('removeCustomCategory / clear', () => {
  it('removes only the named category', async () => {
    await addCustomCategory('h1', 'Pets');
    await addCustomCategory('h1', 'Hobbies');
    const next = await removeCustomCategory('h1', 'Pets');
    expect(next.map((c) => c.name)).toEqual(['Hobbies']);
    expect((await getCustomCategories('h1')).map((c) => c.name)).toEqual(['Hobbies']);
  });

  it('clearCustomCategoriesForHousehold wipes the list', async () => {
    await addCustomCategory('h1', 'Pets');
    await clearCustomCategoriesForHousehold('h1');
    expect(await getCustomCategories('h1')).toEqual([]);
  });
});

describe('getCustomCategories resilience', () => {
  it('returns [] for corrupt or wrongly-shaped storage', async () => {
    store.set('bs.customCategories.h1', '{not json');
    expect(await getCustomCategories('h1')).toEqual([]);
    store.set('bs.customCategories.h1', JSON.stringify([{ name: 1 }, { name: 'ok', color: '#fff' }]));
    expect(await getCustomCategories('h1')).toEqual([{ name: 'ok', color: '#fff' }]);
  });
});

describe('cachedCustomCategories', () => {
  it('is empty before the first real household load', () => {
    expect(cachedCustomCategories()).toEqual([]);
  });

  it('mirrors the last successful read or write so list rows can resolve colors sync', async () => {
    const added = await addCustomCategory('h1', 'Pets');
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    expect(cachedCustomCategories()).toEqual([added.added]);

    await getCustomCategories('h2');
    expect(cachedCustomCategories()).toEqual([]);

    expect(await getCustomCategories('h1')).toEqual([added.added]);
    expect(cachedCustomCategories()).toEqual([added.added]);
  });

  it('does not expose a live mutable reference to the in-memory cache', async () => {
    await addCustomCategory('h1', 'Pets');
    const snapshot = cachedCustomCategories();
    snapshot.push({ name: 'Hacked', color: '#000' });
    expect(cachedCustomCategories().map((c) => c.name)).toEqual(['Pets']);
  });
});

describe('resolveCategoryColor', () => {
  const builtIn = { Groceries: '#111' };
  const customs = [{ name: 'Pets', color: '#222' }];
  it('prefers built-in, then custom, then fallback', () => {
    expect(resolveCategoryColor('Groceries', builtIn, customs, '#fff')).toBe('#111');
    expect(resolveCategoryColor('Pets', builtIn, customs, '#fff')).toBe('#222');
    expect(resolveCategoryColor('Deleted', builtIn, customs, '#fff')).toBe('#fff');
  });
});

describe('applyCustomCategories (cloud copy)', () => {
  it('replaces the local list, dropping malformed, duplicate (any case) and over-limit entries', async () => {
    await addCustomCategory('h1', 'Local only');
    await clearPendingCustomCategoryChanges('h1', { add: ['Local only'] }); // acknowledged
    const incoming: unknown[] = [
      { name: 'Pets', color: '#111' },
      { name: 'pets', color: '#222' },
      { name: 5 },
      'junk',
      { name: 'Hobbies', color: '#333' },
    ];
    const next = await applyCustomCategories('h1', incoming);
    expect(next).toEqual([
      { name: 'Pets', color: '#111' },
      { name: 'Hobbies', color: '#333' },
    ]);
    expect(await getCustomCategories('h1')).toEqual(next);
  });

  it('caps at MAX_CUSTOM_CATEGORIES', async () => {
    const many = Array.from({ length: MAX_CUSTOM_CATEGORIES + 5 }, (_, i) => ({
      name: `C${i}`,
      color: '#000',
    }));
    expect(await applyCustomCategories('h1', many)).toHaveLength(MAX_CUSTOM_CATEGORIES);
  });

  it('an empty cloud list clears local categories', async () => {
    await addCustomCategory('h1', 'Pets');
    await clearPendingCustomCategoryChanges('h1', { add: ['Pets'] }); // acknowledged
    expect(await applyCustomCategories('h1', [])).toEqual([]);
  });
});

describe('synced flag', () => {
  it('defaults false, persists, and is per household', async () => {
    expect(await getCustomCategoriesSynced('h1')).toBe(false);
    await setCustomCategoriesSynced('h1');
    expect(await getCustomCategoriesSynced('h1')).toBe(true);
    expect(await getCustomCategoriesSynced('h2')).toBe(false);
  });
});

describe('pending local changes survive cloud snapshots (race fix)', () => {
  it('keeps a just-added category when a stale snapshot arrives before the write is acknowledged', async () => {
    await addCustomCategory('h1', 'Pets');
    // Another member's update lands; the cloud copy does not have Pets yet.
    const next = await applyCustomCategories('h1', [{ name: 'Hobbies', color: '#333' }]);
    expect(next.map((c) => c.name)).toEqual(['Hobbies', 'Pets']);
    expect((await getPendingCustomCategoryChanges('h1')).add.map((c) => c.name)).toEqual(['Pets']);
  });

  it('stops shielding once the cloud reflects the add', async () => {
    await addCustomCategory('h1', 'Pets');
    await applyCustomCategories('h1', [{ name: 'Pets', color: '#111' }]);
    expect((await getPendingCustomCategoryChanges('h1')).add).toEqual([]);
    // later cloud removal by someone else now sticks
    expect(await applyCustomCategories('h1', [])).toEqual([]);
  });

  it('keeps a just-removed category gone until the cloud reflects the removal', async () => {
    await applyCustomCategories('h1', [{ name: 'Pets', color: '#111' }]);
    await removeCustomCategory('h1', 'Pets');
    const stale = await applyCustomCategories('h1', [{ name: 'Pets', color: '#111' }]);
    expect(stale).toEqual([]);
    expect((await getPendingCustomCategoryChanges('h1')).remove).toEqual(['Pets']);
    // cloud caught up
    expect(await applyCustomCategories('h1', [])).toEqual([]);
    expect((await getPendingCustomCategoryChanges('h1')).remove).toEqual([]);
  });

  it('re-adding a removed name cancels the pending removal', async () => {
    await applyCustomCategories('h1', [{ name: 'Pets', color: '#111' }]);
    await removeCustomCategory('h1', 'Pets');
    await addCustomCategory('h1', 'Pets');
    const p = await getPendingCustomCategoryChanges('h1');
    expect(p.remove).toEqual([]);
    expect(p.add.map((c) => c.name)).toEqual(['Pets']);
  });

  it('removing a pending add cancels it instead of queueing a removal of nothing', async () => {
    await addCustomCategory('h1', 'Pets');
    await removeCustomCategory('h1', 'Pets');
    expect((await getPendingCustomCategoryChanges('h1')).add).toEqual([]);
  });

  it('clearing the household wipes pending state; ack only clears named entries', async () => {
    await addCustomCategory('h1', 'Pets');
    await addCustomCategory('h1', 'Hobbies');
    await clearPendingCustomCategoryChanges('h1', { add: ['pets'] });
    expect((await getPendingCustomCategoryChanges('h1')).add.map((c) => c.name)).toEqual(['Hobbies']);
    await clearCustomCategoriesForHousehold('h1');
    expect(await getPendingCustomCategoryChanges('h1')).toEqual({ add: [], remove: [] });
  });

  it('tolerates corrupt pending storage', async () => {
    store.set('bs.customCategories.pending.h1', '{oops');
    expect(await getPendingCustomCategoryChanges('h1')).toEqual({ add: [], remove: [] });
  });
});

describe('concurrent add and cloud snapshot (race fix)', () => {
  const cloud = [{ name: 'Hobbies', color: '#333' }];

  it('add then snapshot: new category and remote one both survive', async () => {
    const [added, applied] = await Promise.all([
      addCustomCategory('h1', 'Pets'),
      applyCustomCategories('h1', cloud),
    ]);
    expect(added.ok).toBe(true);
    // the snapshot ran after the add, so it re-applied the pending 'Pets'
    expect(applied.map((c) => c.name).sort()).toEqual(['Hobbies', 'Pets']);
    expect((await getCustomCategories('h1')).map((c) => c.name).sort()).toEqual(['Hobbies', 'Pets']);
  });

  it('snapshot then add: both survive', async () => {
    await Promise.all([
      applyCustomCategories('h1', cloud),
      addCustomCategory('h1', 'Pets'),
    ]);
    expect((await getCustomCategories('h1')).map((c) => c.name).sort()).toEqual(['Hobbies', 'Pets']);
  });

  it('snapshot interleaved between two adds never drops either', async () => {
    await Promise.all([
      addCustomCategory('h1', 'One'),
      applyCustomCategories('h1', cloud),
      addCustomCategory('h1', 'Two'),
      applyCustomCategories('h1', cloud),
    ]);
    expect((await getCustomCategories('h1')).map((c) => c.name).sort()).toEqual([
      'Hobbies',
      'One',
      'Two',
    ]);
  });

  it('a failing mutation does not wedge the lock', async () => {
    await expect(addCustomCategory('h1', '   ')).resolves.toEqual({ ok: false, reason: 'empty' });
    await expect(addCustomCategory('h1', 'Pets')).resolves.toMatchObject({ ok: true });
  });
});
