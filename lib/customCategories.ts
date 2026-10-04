import * as SecureStore from 'expo-secure-store';
import { ALL_CATEGORIES } from '../constants/categories';

/** A user-defined spending category (Premium). Assignable to line items
 *  and budgetable like the built-in ones. Stored per household, on this
 *  device: budgets for it sync through the household budgets doc, the
 *  definition (icon/color) does not — other members fall back to a
 *  neutral color for an unknown name. */
export interface CustomCategory {
  name: string;
  color: string;
}

export const MAX_CUSTOM_CATEGORIES = 20;
export const MAX_CUSTOM_CATEGORY_NAME = 24;

/** Cycled in order as the user adds categories. */
export const CUSTOM_CATEGORY_COLORS = [
  '#D6336C',
  '#0CA678',
  '#F08C00',
  '#7048E8',
  '#1C7ED6',
  '#E8590C',
  '#099268',
  '#AE3EC9',
];

const KEY = 'bs.customCategories';

const storageKey = (householdId: string) => `${KEY}.${householdId}`;

// Every mutation is a read-modify-write across several SecureStore calls.
// A cloud snapshot (applyCustomCategories) can land in the middle of a
// local add/remove, so all mutators for one household run one at a time.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(householdId: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(householdId) ?? Promise.resolve()).then(fn, fn);
  locks.set(
    householdId,
    run.catch(() => undefined),
  );
  return run;
}

function isCustomCategory(v: unknown): v is CustomCategory {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as CustomCategory).name === 'string' &&
    typeof (v as CustomCategory).color === 'string'
  );
}

// Last list loaded or saved, for synchronous color/icon lookups in list
// rows that can't await (see cachedCustomCategories). Kept fresh by every
// read and write below.
let lastLoaded: CustomCategory[] = [];

/** Most recently loaded custom categories (may be empty before the first
 *  load). Safe to call during render; not a source of truth. */
export function cachedCustomCategories(): CustomCategory[] {
  return lastLoaded.slice();
}

export async function getCustomCategories(householdId: string): Promise<CustomCategory[]> {
  const raw = await SecureStore.getItemAsync(storageKey(householdId));
  let list: CustomCategory[] = [];
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(raw);
      list = Array.isArray(parsed) ? parsed.filter(isCustomCategory) : [];
    } catch {
      list = [];
    }
  }
  lastLoaded = list;
  return list;
}

async function save(householdId: string, list: CustomCategory[]): Promise<void> {
  lastLoaded = list;
  await SecureStore.setItemAsync(storageKey(householdId), JSON.stringify(list));
}

/** Local changes not yet acknowledged by the household's cloud copy.
 *  Kept so a cloud snapshot that lands before our own write finishes
 *  (or while offline) cannot wipe a just-added category or resurrect a
 *  just-removed one. */
export interface PendingCustomCategoryChanges {
  add: CustomCategory[];
  remove: string[];
}

const pendingKey = (householdId: string) => `${KEY}.pending.${householdId}`;

export async function getPendingCustomCategoryChanges(
  householdId: string,
): Promise<PendingCustomCategoryChanges> {
  const empty: PendingCustomCategoryChanges = { add: [], remove: [] };
  const raw = await SecureStore.getItemAsync(pendingKey(householdId));
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as Partial<PendingCustomCategoryChanges>;
    return {
      add: Array.isArray(parsed.add) ? parsed.add.filter(isCustomCategory) : [],
      remove: Array.isArray(parsed.remove)
        ? parsed.remove.filter((n): n is string => typeof n === 'string')
        : [],
    };
  } catch {
    return empty;
  }
}

async function savePending(
  householdId: string,
  pending: PendingCustomCategoryChanges,
): Promise<void> {
  if (pending.add.length === 0 && pending.remove.length === 0) {
    await SecureStore.deleteItemAsync(pendingKey(householdId));
  } else {
    await SecureStore.setItemAsync(pendingKey(householdId), JSON.stringify(pending));
  }
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Drops pending entries the cloud has acknowledged (matched by name). */
export function clearPendingCustomCategoryChanges(
  householdId: string,
  ack: { add?: string[]; remove?: string[] },
): Promise<void> {
  return withLock(householdId, async () => {
    const p = await getPendingCustomCategoryChanges(householdId);
    await savePending(householdId, {
      add: p.add.filter((c) => !(ack.add ?? []).some((n) => sameName(n, c.name))),
      remove: p.remove.filter((n) => !(ack.remove ?? []).some((a) => sameName(a, n))),
    });
  });
}

export type AddCustomCategoryResult =
  | { ok: true; categories: CustomCategory[]; added: CustomCategory }
  | { ok: false; reason: 'empty' | 'tooLong' | 'duplicate' | 'limit' };

/** Validates and appends a category. Names are trimmed, collapsed, and
 *  compared case-insensitively against built-ins (which include the
 *  Recurring budget key) and existing customs. */
export function addCustomCategory(
  householdId: string,
  rawName: string,
): Promise<AddCustomCategoryResult> {
  return withLock(householdId, async () => {
    const name = rawName.trim().replace(/\s+/g, ' ');
    if (!name) return { ok: false, reason: 'empty' } as const;
    if (name.length > MAX_CUSTOM_CATEGORY_NAME) return { ok: false, reason: 'tooLong' } as const;
    const existing = await getCustomCategories(householdId);
    if (existing.length >= MAX_CUSTOM_CATEGORIES) return { ok: false, reason: 'limit' } as const;
    const taken = new Set(
      [...ALL_CATEGORIES, ...existing.map((c) => c.name)].map((n) => n.toLowerCase()),
    );
    if (taken.has(name.toLowerCase())) return { ok: false, reason: 'duplicate' } as const;
    const added: CustomCategory = {
      name,
      color: CUSTOM_CATEGORY_COLORS[existing.length % CUSTOM_CATEGORY_COLORS.length],
    };
    const categories = [...existing, added];
    // Pending first: if the process dies (or a snapshot lands) between the
    // two writes, the change is still shielded.
    const pending = await getPendingCustomCategoryChanges(householdId);
    await savePending(householdId, {
      add: [...pending.add.filter((c) => !sameName(c.name, name)), added],
      remove: pending.remove.filter((n) => !sameName(n, name)),
    });
    await save(householdId, categories);
    return { ok: true, categories, added } as const;
  });
}

/** Removes the definition only. Line items already tagged with the name
 *  keep it (still counted and shown) so no spending history is lost. */
export function removeCustomCategory(
  householdId: string,
  name: string,
): Promise<CustomCategory[]> {
  return withLock(householdId, async () => {
    const next = (await getCustomCategories(householdId)).filter((c) => c.name !== name);
    const pending = await getPendingCustomCategoryChanges(householdId);
    await savePending(householdId, {
      add: pending.add.filter((c) => !sameName(c.name, name)),
      remove: [...pending.remove.filter((n) => !sameName(n, name)), name],
    });
    await save(householdId, next);
    return next;
  });
}

export async function clearCustomCategoriesForHousehold(householdId: string): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(storageKey(householdId)),
    SecureStore.deleteItemAsync(pendingKey(householdId)),
  ]);
}

/** Color for any category name: built-in palette first, then a custom
 *  definition, else the neutral fallback (unknown/deleted/other member's). */
export function resolveCategoryColor(
  name: string,
  builtIn: Record<string, string>,
  customs: CustomCategory[],
  fallback: string,
): string {
  return builtIn[name] ?? customs.find((c) => c.name === name)?.color ?? fallback;
}

/** Replaces this device's list with the household's cloud copy (the
 *  source of truth once synced), then re-applies local changes the cloud
 *  hasn't acknowledged yet: pending adds stay, pending removes stay gone.
 *  A pending entry the cloud already reflects is dropped as acknowledged.
 *  Malformed entries, duplicate names and anything past the limit are
 *  discarded. */
export function applyCustomCategories(
  householdId: string,
  incoming: unknown[],
): Promise<CustomCategory[]> {
  return withLock(householdId, () => applyLocked(householdId, incoming));
}

async function applyLocked(householdId: string, incoming: unknown[]): Promise<CustomCategory[]> {
  const pending = await getPendingCustomCategoryChanges(householdId);
  const seen = new Set<string>();
  const next: CustomCategory[] = [];
  for (const c of incoming) {
    if (!isCustomCategory(c)) continue;
    const key = c.name.toLowerCase();
    if (seen.has(key)) continue;
    if (pending.remove.some((n) => sameName(n, c.name))) continue;
    seen.add(key);
    if (next.length < MAX_CUSTOM_CATEGORIES) next.push({ name: c.name, color: c.color });
  }
  const cloudNames = new Set(incoming.filter(isCustomCategory).map((c) => c.name.toLowerCase()));
  for (const c of pending.add) {
    if (seen.has(c.name.toLowerCase())) continue;
    if (next.length >= MAX_CUSTOM_CATEGORIES) break;
    seen.add(c.name.toLowerCase());
    next.push({ name: c.name, color: c.color });
  }
  await save(householdId, next);
  await savePending(householdId, {
    add: pending.add.filter((c) => !cloudNames.has(c.name.toLowerCase())),
    remove: pending.remove.filter((n) => cloudNames.has(n.toLowerCase())),
  });
  return next;
}

const syncedKey = (householdId: string) => `${KEY}.synced.${householdId}`;

/** True once this device's pre-sync categories were pushed to the cloud
 *  (one-time migration for categories created before sync existed). */
export async function getCustomCategoriesSynced(householdId: string): Promise<boolean> {
  return (await SecureStore.getItemAsync(syncedKey(householdId))) === '1';
}

export async function setCustomCategoriesSynced(householdId: string): Promise<void> {
  await SecureStore.setItemAsync(syncedKey(householdId), '1');
}
