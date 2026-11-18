import { beforeEach, describe, expect, it, vi } from 'vitest';

const deleteDoc = vi.fn();
const setDoc = vi.fn();
const updateDoc = vi.fn();

vi.mock('firebase/firestore', () => ({
  doc: (_db: unknown, ...parts: string[]) => parts.join('/'),
  deleteDoc: (...a: unknown[]) => deleteDoc(...a),
  setDoc: (...a: unknown[]) => setDoc(...a),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
  serverTimestamp: () => 'SERVER_TS',
}));

vi.mock('../../firebase', () => ({ db: {} }));

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

describe('writes', () => {
  beforeEach(() => {
    deleteDoc.mockReset();
    setDoc.mockReset();
    updateDoc.mockReset();
    setDoc.mockResolvedValue(undefined);
    deleteDoc.mockResolvedValue(undefined);
    updateDoc.mockResolvedValue(undefined);
    vi.stubGlobal('crypto', { ...crypto, randomUUID: () => 'fixed-id' });
  });

  it('deletes receipts and incomes under the household', async () => {
    await deleteReceipt('hh', 'r1');
    await deleteIncome('hh', 'i1');
    expect(deleteDoc).toHaveBeenCalledWith('households/hh/receipts/r1');
    expect(deleteDoc).toHaveBeenCalledWith('households/hh/incomes/i1');
  });

  it('rounds and clamps a category budget so a negative cannot wipe spend tracking', async () => {
    await setCategoryBudget('hh', 'Groceries', 12.345);
    expect(setDoc).toHaveBeenCalledWith(
      'households/hh',
      { budgets: { byCategory: { Groceries: 12.35 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
    await setCategoryBudget('hh', 'Groceries', -20);
    expect(setDoc).toHaveBeenLastCalledWith(
      'households/hh',
      { budgets: { byCategory: { Groceries: 0 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('writes budget alerts as a nested merge so other budget fields survive', async () => {
    await setBudgetAlertsEnabled('hh', false);
    expect(setDoc).toHaveBeenCalledWith(
      'households/hh',
      { budgets: { alertsEnabled: false }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('records a settlement as its own ledger doc, never a receipt', async () => {
    await addSettlement('hh', 'a', 'b', 10.129);
    expect(setDoc).toHaveBeenCalledWith('households/hh/settlements/fixed-id', {
      fromUid: 'a',
      toUid: 'b',
      amountUsd: 10.13,
      createdAt: expect.any(String),
    });
  });

  it('trims goal text, clamps allocated below zero, and treats blank notes as null', async () => {
    await saveGoal('hh', { id: 'g1', name: '  Trip  ', targetUsd: 500, allocatedUsd: -3, notes: '   ', createdAt: '2026-01-01T00:00:00.000Z' });
    expect(setDoc).toHaveBeenCalledWith(
      'households/hh/savingsGoals/g1',
      expect.objectContaining({ name: 'Trip', allocatedUsd: 0, notes: null, createdAt: '2026-01-01T00:00:00.000Z' }),
    );
  });

  it('stops a recurring template without deleting past occurrences', async () => {
    await stopRecurring('hh', 'receipts', 'r1');
    expect(updateDoc).toHaveBeenCalledWith('households/hh/receipts/r1', {
      recurring: null,
      updatedAt: expect.any(String),
    });
  });

  it('writes investments under the user, not the household', async () => {
    await saveInvestment('u1', {
      id: 'a1',
      name: ' TFSA ',
      kind: 'etf',
      contributedUsd: 100,
      valueUsd: 110,
      notes: '  ',
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(setDoc).toHaveBeenCalledWith('users/u1/investmentAccounts/a1', {
      name: 'TFSA',
      kind: 'etf',
      contributedUsd: 100,
      valueUsd: 110,
      notes: null,
      createdAt: 'c',
      updatedAt: 'u',
    });
    await saveInvestmentSnapshot('u1', { id: 's1', accountId: 'a1', date: '2026-01-01', valueUsd: 110, contributedUsd: 100, createdAt: 'c' });
    expect(setDoc).toHaveBeenCalledWith('users/u1/investmentSnapshots/s1', {
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 110,
      contributedUsd: 100,
      createdAt: 'c',
    });
  });

  it('deletes snapshots before the account', async () => {
    await deleteInvestment('u1', 'a1', ['s1', 's2']);
    expect(deleteDoc.mock.calls.map((c) => c[0])).toEqual([
      'users/u1/investmentSnapshots/s1',
      'users/u1/investmentSnapshots/s2',
      'users/u1/investmentAccounts/a1',
    ]);
  });

  it('deletes a goal under the household', async () => {
    await deleteGoal('hh', 'g1');
    expect(deleteDoc).toHaveBeenCalledWith('households/hh/savingsGoals/g1');
  });
});
