import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
const deleteDoc = vi.fn();
const updateDoc = vi.fn();
const doc = vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') }));
const serverTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/firestore', () => ({
  setDoc: (...a: unknown[]) => setDoc(...a),
  deleteDoc: (...a: unknown[]) => deleteDoc(...a),
  updateDoc: (...a: unknown[]) => updateDoc(...a),
  doc: (...a: unknown[]) => doc(...a),
  serverTimestamp: () => serverTimestamp(),
}));

vi.mock('../../firebase', () => ({ db: { name: 'db' } }));

const uuid = vi.spyOn(crypto, 'randomUUID');

import {
  addSettlement,
  deleteInvestment,
  saveGoal,
  setBudgetAlertsEnabled,
  setCategoryBudget,
  stopRecurring,
} from '../writes';

beforeEach(() => {
  setDoc.mockReset();
  deleteDoc.mockReset();
  updateDoc.mockReset();
  doc.mockClear();
  uuid.mockReset();
  uuid.mockReturnValue('fixed-id');
});

describe('setCategoryBudget', () => {
  it('rounds to cents, clamps negatives to 0, and nested-merges one category', async () => {
    await setCategoryBudget('hh1', 'Groceries', 12.345);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Groceries: 12.35 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
    await setCategoryBudget('hh1', 'Dining', -8);
    expect(setDoc).toHaveBeenLastCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Dining: 0 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });
});

describe('setBudgetAlertsEnabled', () => {
  it('writes alertsEnabled under budgets with a merge so other budget fields stay', async () => {
    await setBudgetAlertsEnabled('hh1', false);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { alertsEnabled: false }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });
});

describe('addSettlement', () => {
  it('rounds the amount and writes a ledger row, never a receipt', async () => {
    await addSettlement('hh1', 'from', 'to', 10.129);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/settlements/fixed-id' },
      expect.objectContaining({
        fromUid: 'from',
        toUid: 'to',
        amountUsd: 10.13,
      }),
    );
  });
});

describe('saveGoal', () => {
  it('trims name/notes, clamps allocated below zero, and reuses an existing id', async () => {
    await saveGoal('hh1', {
      id: 'g1',
      name: '  Trip  ',
      targetUsd: 500,
      allocatedUsd: -20,
      notes: '  fly  ',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/savingsGoals/g1' },
      expect.objectContaining({
        name: 'Trip',
        allocatedUsd: 0,
        notes: 'fly',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    );
  });

  it('stores empty notes as null and mints an id for a new goal', async () => {
    await saveGoal('hh1', { name: 'Bike', targetUsd: 100, allocatedUsd: 10, notes: '  ' });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/savingsGoals/fixed-id' },
      expect.objectContaining({ notes: null }),
    );
  });
});

describe('stopRecurring', () => {
  it('clears the schedule on the existing row instead of deleting it', async () => {
    await stopRecurring('hh1', 'receipts', 'r1');
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/receipts/r1' },
      expect.objectContaining({ recurring: null }),
    );
  });
});

describe('deleteInvestment', () => {
  it('deletes snapshots before the account, under the user not the household', async () => {
    await deleteInvestment('u1', 'a1', ['s1', 's2']);
    expect(deleteDoc.mock.calls.map((c) => c[0])).toEqual([
      { path: 'users/u1/investmentSnapshots/s1' },
      { path: 'users/u1/investmentSnapshots/s2' },
      { path: 'users/u1/investmentAccounts/a1' },
    ]);
  });
});
