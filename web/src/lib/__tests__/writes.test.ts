import { beforeEach, describe, expect, it, vi } from 'vitest';

type DocRef = { path: string };

const { setDoc, deleteDoc, updateDoc, doc } = vi.hoisted(() => {
  const doc = vi.fn((_db: unknown, ...parts: string[]): DocRef => ({ path: parts.join('/') }));
  const setDoc = vi.fn(async (_ref: DocRef, _data: unknown, _opts?: unknown) => undefined);
  const deleteDoc = vi.fn(async (_ref: DocRef) => undefined);
  const updateDoc = vi.fn(async (_ref: DocRef, _data: unknown) => undefined);
  return { setDoc, deleteDoc, updateDoc, doc };
});

vi.mock('firebase/firestore', () => ({
  doc,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp: () => 'SERVER_TS',
}));
vi.mock('../../firebase', () => ({ db: { __fake: true } }));

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
  setDoc.mockClear();
  deleteDoc.mockClear();
  updateDoc.mockClear();
  doc.mockClear();
  vi.stubGlobal('crypto', { ...crypto, randomUUID: () => 'fixed-id' });
});

describe('household writes', () => {
  it('deletes receipts and incomes under the household', async () => {
    await deleteReceipt('hh1', 'r1');
    await deleteIncome('hh1', 'i1');
    expect(deleteDoc).toHaveBeenCalledTimes(2);
    expect(doc.mock.calls.map((c) => c.slice(1))).toEqual([
      ['households', 'hh1', 'receipts', 'r1'],
      ['households', 'hh1', 'incomes', 'i1'],
    ]);
  });

  it('rounds and clamps a category budget, nested-merging so other categories survive', async () => {
    await setCategoryBudget('hh1', 'Groceries', -12.345);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Groceries: 0 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
    await setCategoryBudget('hh1', 'Dining', 19.999);
    expect(setDoc.mock.calls[1][1]).toEqual({ budgets: { byCategory: { Dining: 20 } }, updatedAt: 'SERVER_TS' });
  });

  it('writes the alerts flag without wiping byCategory', async () => {
    await setBudgetAlertsEnabled('hh1', false);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { alertsEnabled: false }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });

  it('records a settlement as a new ledger row, never a receipt', async () => {
    await addSettlement('hh1', 'from', 'to', 12.345);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/settlements/fixed-id' },
      { fromUid: 'from', toUid: 'to', amountUsd: 12.35, createdAt: expect.any(String) },
    );
  });

  it('trims goal names, floors allocatedUsd at 0, and treats blank notes as null', async () => {
    await saveGoal('hh1', { name: '  Trip ', targetUsd: 1000, allocatedUsd: -5, notes: '  ' });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/savingsGoals/fixed-id' },
      expect.objectContaining({ name: 'Trip', targetUsd: 1000, allocatedUsd: 0, notes: null }),
    );
  });

  it('clears a recurring schedule in place', async () => {
    await stopRecurring('hh1', 'incomes', 'inc-1');
    expect(updateDoc).toHaveBeenCalledWith(
      { path: 'households/hh1/incomes/inc-1' },
      { recurring: null, updatedAt: expect.any(String) },
    );
  });

  it('deletes a savings goal under the household', async () => {
    await deleteGoal('hh1', 'g1');
    expect(doc).toHaveBeenCalledWith(expect.anything(), 'households', 'hh1', 'savingsGoals', 'g1');
  });
});

describe('personal investment writes', () => {
  it('writes accounts and snapshots under users/{uid}, not the household', async () => {
    await saveInvestment('u1', {
      id: 'a1',
      name: '  TFSA ',
      kind: 'etf',
      contributedUsd: 100,
      valueUsd: 110,
      notes: '  keep ',
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'users/u1/investmentAccounts/a1' },
      {
        name: 'TFSA',
        kind: 'etf',
        contributedUsd: 100,
        valueUsd: 110,
        notes: 'keep',
        createdAt: 'c',
        updatedAt: 'u',
      },
    );
    await saveInvestmentSnapshot('u1', {
      id: 's1',
      accountId: 'a1',
      date: '2026-01-01',
      valueUsd: 110,
      contributedUsd: 100,
      createdAt: 'c',
    });
    expect(doc.mock.calls.some((c) => c.slice(1).join('/') === 'users/u1/investmentSnapshots/s1')).toBe(true);
  });

  it('deletes snapshots first, then the account', async () => {
    await deleteInvestment('u1', 'a1', ['s1', 's2']);
    expect(deleteDoc.mock.calls.map((c) => c[0]?.path)).toEqual([
      'users/u1/investmentSnapshots/s1',
      'users/u1/investmentSnapshots/s2',
      'users/u1/investmentAccounts/a1',
    ]);
  });
});
