type Doc = { exists: boolean; data: () => Record<string, unknown> };

const store = new Map<string, Record<string, unknown>>();
const mockServerTimestamp = { __type: 'serverTimestamp' };

function pathKey(collection: string, id: string) {
  return `${collection}/${id}`;
}

function makeDocRef(collection: string, id: string) {
  return {
    get: jest.fn(async (): Promise<Doc> => {
      const data = store.get(pathKey(collection, id));
      return { exists: data !== undefined, data: () => data ?? {} };
    }),
    set: jest.fn(async (data: Record<string, unknown>) => {
      // Mirrors the real SDK's create-vs-update rule enforcement just
      // enough for these tests: a second set() on the SAME
      // promoRedemptions doc simulates firestore.rules' "allow update:
      // if false" by throwing the same permission-denied shape the
      // real client throws when a rule rejects a write.
      if (collection === 'promoRedemptions' && store.has(pathKey(collection, id))) {
        const err: { code: string; message: string } = {
          code: 'firestore/permission-denied',
          message: 'PERMISSION_DENIED',
        };
        throw err;
      }
      store.set(pathKey(collection, id), data);
    }),
  };
}

jest.mock('@react-native-firebase/firestore', () => {
  const firestoreFn = () => ({
    collection: (collection: string) => ({
      doc: (id: string) => makeDocRef(collection, id),
    }),
  });
  firestoreFn.Timestamp = { fromDate: (d: Date) => ({ toDate: () => d }) };
  firestoreFn.FieldValue = { serverTimestamp: () => mockServerTimestamp };
  return { default: firestoreFn };
});

import { redeemPromoCode, getActivePromoRedemption } from '../lib/promoCode';

beforeEach(() => {
  store.clear();
  jest.clearAllMocks();
});

function seedCode(code: string, fields: Record<string, unknown>) {
  store.set(pathKey('promoCodes', code), fields);
}

describe('redeemPromoCode', () => {
  it('rejects a blank code without writing', async () => {
    await expect(redeemPromoCode('   ', 'u1')).resolves.toEqual({
      ok: false,
      reason: 'Enter a code first.',
    });
    expect(store.size).toBe(0);
  });

  it('rejects a code that grants neither Premium nor free days', async () => {
    seedCode('NOOP', { active: true, grantsPro: false, freeDays: 0 });
    await expect(redeemPromoCode('NOOP', 'u1')).resolves.toEqual({
      ok: false,
      reason: "That code isn't valid.",
    });
    expect(store.has('promoRedemptions/u1')).toBe(false);
  });

  it('a grantsPro code stays permanent even when freeDays is also set', async () => {
    seedCode('BOTH', { active: true, grantsPro: true, freeDays: 30 });
    const result = await redeemPromoCode('BOTH', 'u1');
    expect(result).toEqual({
      ok: true,
      redemption: { code: 'BOTH', grantsPro: true, freeUntil: null },
    });
  });

  it('rejects an unknown code', async () => {
    const result = await redeemPromoCode('NOPE', 'u1');
    expect(result).toEqual({ ok: false, reason: "That code isn't valid." });
  });

  it('rejects an inactive code', async () => {
    seedCode('OLDCODE', { active: false, grantsPro: true });
    const result = await redeemPromoCode('OLDCODE', 'u1');
    expect(result).toEqual({ ok: false, reason: 'That code has expired.' });
  });

  it('grants permanent Premium for a grantsPro code, case- and whitespace-insensitively', async () => {
    seedCode('FRIENDS2026', { active: true, grantsPro: true });
    const result = await redeemPromoCode('  friends2026  ', 'u1');
    expect(result).toEqual({
      ok: true,
      redemption: { code: 'FRIENDS2026', grantsPro: true, freeUntil: null },
    });
  });

  it('grants a time-limited window for a freeDays code', async () => {
    seedCode('WELCOME30', { active: true, grantsPro: false, freeDays: 30 });
    const before = Date.now();
    const result = await redeemPromoCode('WELCOME30', 'u1');
    if (!result.ok) throw new Error('expected ok');
    expect(result.redemption.grantsPro).toBe(false);
    expect(result.redemption.freeUntil).not.toBeNull();
    const deltaMs = result.redemption.freeUntil!.getTime() - before;
    expect(deltaMs).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    expect(deltaMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000 + 5000);
  });

  it('rejects a second redemption on the same account', async () => {
    seedCode('FRIENDS2026', { active: true, grantsPro: true });
    seedCode('WELCOME30', { active: true, grantsPro: false, freeDays: 30 });
    const first = await redeemPromoCode('FRIENDS2026', 'u1');
    expect(first.ok).toBe(true);
    const second = await redeemPromoCode('WELCOME30', 'u1');
    expect(second).toEqual({
      ok: false,
      reason: "You've already redeemed a promo code on this account.",
    });
  });

  it('tracks redemptions independently per uid', async () => {
    seedCode('FRIENDS2026', { active: true, grantsPro: true });
    const u1 = await redeemPromoCode('FRIENDS2026', 'u1');
    const u2 = await redeemPromoCode('FRIENDS2026', 'u2');
    expect(u1.ok).toBe(true);
    expect(u2.ok).toBe(true);
  });
});

describe('getActivePromoRedemption', () => {
  it('returns null when the user never redeemed anything', async () => {
    expect(await getActivePromoRedemption('u1')).toBeNull();
  });

  it('returns the grant after a successful grantsPro redemption', async () => {
    seedCode('FRIENDS2026', { active: true, grantsPro: true });
    await redeemPromoCode('FRIENDS2026', 'u1');
    expect(await getActivePromoRedemption('u1')).toEqual({
      code: 'FRIENDS2026',
      grantsPro: true,
      freeUntil: null,
    });
  });

  it('returns null once a freeDays grant has elapsed', async () => {
    store.set(pathKey('promoRedemptions', 'u1'), {
      uid: 'u1',
      code: 'WELCOME30',
      grantsPro: false,
      freeUntil: { toDate: () => new Date(Date.now() - 1000) },
      redeemedAt: mockServerTimestamp,
    });
    expect(await getActivePromoRedemption('u1')).toBeNull();
  });

  it('returns the grant while a freeDays window is still active', async () => {
    const future = new Date(Date.now() + 60_000);
    store.set(pathKey('promoRedemptions', 'u1'), {
      uid: 'u1',
      code: 'WELCOME30',
      grantsPro: false,
      freeUntil: { toDate: () => future },
      redeemedAt: mockServerTimestamp,
    });
    expect(await getActivePromoRedemption('u1')).toEqual({
      code: 'WELCOME30',
      grantsPro: false,
      freeUntil: future,
    });
  });
});
