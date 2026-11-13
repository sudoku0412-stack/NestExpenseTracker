import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
const deleteDoc = vi.fn();
const updateDoc = vi.fn();
const serverTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('../../firebase', () => ({ db: { __brand: 'db' } }));
vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => ({ path: parts.join('/') }),
  setDoc: (...a: unknown[]) => setDoc(...a),
  deleteDoc: (...a: unknown[]) => deleteDoc(...a),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
  serverTimestamp: () => serverTimestamp(),
}));

import {
  addSettlement,
  deleteGoal,
  deleteIncome,
  deleteInvestment,
  deleteReceipt,
  saveGoal,
  saveInvestment,
  saveInvestmentSnapshot,
  setBudgetAlertsEnabled,
  setCategoryBudget,
  stopRecurring,
} from '../writes';

beforeEach(() => {
  setDoc.mockReset();
  deleteDoc.mockReset();
  updateDoc.mockReset();
  vi.stubGlobal('crypto', { randomUUID: () => 'uuid-1' });
});

describe('writes', () => {
  it('deletes receipts and incomes under the household', async () => {
    await deleteReceipt('hh1', 'r1');
    await deleteIncome('hh1', 'i1');
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'households/hh1/receipts/r1' });
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'households/hh1/incomes/i1' });
  });

  it('clamps a negative budget to 0 and rounds to cents, nested-merging one category', async () => {
    await setCategoryBudget('hh1', 'Groceries', -12.345);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Groceries: 0 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
    await setCategoryBudget('hh1', 'Dining', 19.999);
    expect(setDoc).toHaveBeenLastCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Dining: 20 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('toggles budget alerts without wiping byCategory', async () => {
    await setBudgetAlertsEnabled('hh1', false);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { alertsEnabled: false }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('writes a settlement ledger row, never a receipt, rounded to cents', async () => {
    await addSettlement('hh1', 'a', 'b', 12.345);
    expect(setDoc.mock.calls[0][0]).toEqual({ path: 'households/hh1/settlements/uuid-1' });
    expect(setDoc.mock.calls[0][1]).toMatchObject({ fromUid: 'a', toUid: 'b', amountUsd: 12.35 });
    expect(setDoc.mock.calls[0][1].createdAt).toEqual(expect.any(String));
  });

  it('trims goal fields, never stores a negative allocated amount, and nulls blank notes', async () => {
    await saveGoal('hh1', { name: '  Trip  ', targetUsd: 1000, allocatedUsd: -5, notes: '  ' });
    expect(setDoc.mock.calls[0][0]).toEqual({ path: 'households/hh1/savingsGoals/uuid-1' });
    expect(setDoc.mock.calls[0][1]).toMatchObject({
      name: 'Trip',
      targetUsd: 1000,
      allocatedUsd: 0,
      notes: null,
    });
  });

  it('deletes a goal and clears recurring on a template without deleting the row', async () => {
    await deleteGoal('hh1', 'g1');
    await stopRecurring('hh1', 'receipts', 'r9');
    expect(deleteDoc).toHaveBeenCalledWith({ path: 'households/hh1/savingsGoals/g1' });
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/receipts/r9' },
      { recurring: null, updatedAt: expect.any(String) },
    );
  });

  it('writes personal investments under users/{uid}, never the household', async () => {
    await saveInvestment('u1', {
      id: 'a1',
      name: '  TFSA  ',
      kind: 'etf',
      contributedUsd: 100,
      valueUsd: 120,
      notes: '  ',
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'users/u1/investmentAccounts/a1' },
      {
        name: 'TFSA',
        kind: 'etf',
        contributedUsd: 100,
        valueUsd: 120,
        notes: null,
        createdAt: 'c',
        updatedAt: 'u',
      },
    );
    await saveInvestmentSnapshot('u1', {
      id: 's1',
      accountId: 'a1',
      date: '2026-03-01',
      valueUsd: 120,
      contributedUsd: 100,
      createdAt: 'c',
    });
    expect(setDoc).toHaveBeenLastCalledWith(
      { path: 'users/u1/investmentSnapshots/s1' },
      { accountId: 'a1', date: '2026-03-01', valueUsd: 120, contributedUsd: 100, createdAt: 'c' },
    );
  });

  it('deletes snapshots before the account so history cannot orphan', async () => {
    const order: string[] = [];
    deleteDoc.mockImplementation(async (ref: { path: string }) => {
      order.push(ref.path);
    });
    await deleteInvestment('u1', 'a1', ['s1', 's2']);
    expect(order).toEqual(['users/u1/investmentSnapshots/s1', 'users/u1/investmentSnapshots/s2', 'users/u1/investmentAccounts/a1']);
  });
});
