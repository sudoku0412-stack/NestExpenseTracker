import { beforeEach, describe, expect, it, vi } from 'vitest';

const { setDoc, deleteDoc, updateDoc, serverTimestamp, doc } = vi.hoisted(() => ({
  setDoc: vi.fn(async () => undefined),
  deleteDoc: vi.fn(async () => undefined),
  updateDoc: vi.fn(async () => undefined),
  serverTimestamp: vi.fn(() => 'SERVER_TS'),
  doc: vi.fn((_db: unknown, ...parts: string[]) => ({ path: parts.join('/') })),
}));

vi.mock('firebase/firestore', () => ({
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  doc,
}));
vi.mock('../../firebase', () => ({ db: {} }));

import {
  addSettlement,
  clampNonNegUsd,
  deleteGoal,
  deleteInvestment,
  roundUsd,
  saveGoal,
  saveInvestment,
  setBudgetAlertsEnabled,
  setCategoryBudget,
  stopRecurring,
} from '../writes';

describe('roundUsd / clampNonNegUsd', () => {
  it('rounds to cents and never stores a negative budget', () => {
    expect(roundUsd(1.239)).toBe(1.24);
    expect(clampNonNegUsd(-4.2)).toBe(0);
    expect(clampNonNegUsd(10.006)).toBe(10.01);
  });
});

describe('firestore writes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-0000-0000-00000000id01');
  });

  it('merges a clamped category budget onto the household doc', async () => {
    await setCategoryBudget('hh1', 'Groceries', -12.345);
    expect(doc).toHaveBeenCalledWith({}, 'households', 'hh1');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Groceries: 0 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('writes budget alerts without touching category amounts', async () => {
    await setBudgetAlertsEnabled('hh1', false);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { alertsEnabled: false }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('records a settlement as a ledger row, never a receipt', async () => {
    await addSettlement('hh1', 'from', 'to', 12.345);
    expect(doc).toHaveBeenCalledWith({}, 'households', 'hh1', 'settlements', '00000000-0000-0000-0000-00000000id01');
    expect(setDoc).toHaveBeenCalledWith(
        { path: 'households/hh1/settlements/00000000-0000-0000-0000-00000000id01' },
      expect.objectContaining({ fromUid: 'from', toUid: 'to', amountUsd: 12.35 }),
    );
  });

  it('trims goal fields and clamps allocatedUsd', async () => {
    await saveGoal('hh1', { name: '  Vacation ', targetUsd: 500, allocatedUsd: -20, notes: '  ' });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/savingsGoals/00000000-0000-0000-0000-00000000id01' },
      expect.objectContaining({ name: 'Vacation', allocatedUsd: 0, notes: null }),
    );
  });

  it('deleteGoal and stopRecurring hit the expected paths', async () => {
    await deleteGoal('hh1', 'g1');
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'households/hh1/savingsGoals/g1' });
    await stopRecurring('hh1', 'incomes', 'inc-1');
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/incomes/inc-1' },
      expect.objectContaining({ recurring: null }),
    );
  });

  it('saves investments under users/{uid}, never the household', async () => {
    await saveInvestment('u1', {
      id: 'a1',
      name: '  TFSA ',
      kind: 'etf',
      contributedUsd: 100,
      valueUsd: 120,
      notes: '',
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(doc).toHaveBeenCalledWith({}, 'users', 'u1', 'investmentAccounts', 'a1');
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'users/u1/investmentAccounts/a1' },
      expect.objectContaining({ name: 'TFSA', notes: null, kind: 'etf' }),
    );
  });

  it('deletes snapshots before the investment account', async () => {
    const order: string[] = [];
    deleteDoc.mockImplementation(async (...args: unknown[]) => {
      order.push((args[0] as { path: string }).path);
    });
    await deleteInvestment('u1', 'a1', ['s1', 's2']);
    expect(order).toEqual([
      'users/u1/investmentSnapshots/s1',
      'users/u1/investmentSnapshots/s2',
      'users/u1/investmentAccounts/a1',
    ]);
  });
});
