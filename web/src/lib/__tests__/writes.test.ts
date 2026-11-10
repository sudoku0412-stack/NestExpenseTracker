import { beforeEach, describe, expect, it, vi } from 'vitest';

const setDoc = vi.fn();
const deleteDoc = vi.fn();
const updateDoc = vi.fn();
const doc = vi.fn((_db: unknown, ...path: string[]) => ({ path: path.join('/') }));
const serverTimestamp = vi.fn(() => 'SERVER_TS');

vi.mock('firebase/firestore', () => ({
  setDoc: (...args: unknown[]) => setDoc(...args),
  deleteDoc: (...args: unknown[]) => deleteDoc(...args),
  updateDoc: (...args: unknown[]) => updateDoc(...args),
  doc: (...args: unknown[]) => doc(...args),
  serverTimestamp: () => serverTimestamp(),
}));
vi.mock('../../firebase', () => ({ db: { name: 'db' } }));

import {
  addSettlement,
  deleteInvestment,
  saveGoal,
  saveInvestment,
  setBudgetAlertsEnabled,
  setCategoryBudget,
  stopRecurring,
} from '../writes';

describe('web Firestore writes', () => {
  beforeEach(() => {
    setDoc.mockReset().mockResolvedValue(undefined);
    deleteDoc.mockReset().mockResolvedValue(undefined);
    updateDoc.mockReset().mockResolvedValue(undefined);
    doc.mockClear();
    vi.spyOn(crypto, 'randomUUID').mockReturnValue('fixed-id' as ReturnType<typeof crypto.randomUUID>);
  });

  it('clamps a category budget to a non-negative cent and merges only that key', async () => {
    await setCategoryBudget('hh1', 'Dining', -12.345);
    expect(doc.mock.calls[0].slice(1)).toEqual(['households', 'hh1']);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { byCategory: { Dining: 0 } }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
    setDoc.mockClear();
    await setCategoryBudget('hh1', 'Dining', 12.345);
    expect(setDoc.mock.calls[0][1].budgets.byCategory.Dining).toBe(12.35);
  });

  it('records a settlement on the household ledger, never as a receipt', async () => {
    await addSettlement('hh1', 'from', 'to', 10.126);
    expect(doc.mock.calls.at(-1)?.slice(1)).toEqual(['households', 'hh1', 'settlements', 'fixed-id']);
    expect(setDoc.mock.calls[0][1]).toMatchObject({ fromUid: 'from', toUid: 'to', amountUsd: 10.13 });
  });

  it('trims a goal name and never stores a negative allocated amount', async () => {
    await saveGoal('hh1', { id: 'g1', name: '  Trip  ', targetUsd: 500, allocatedUsd: -20, notes: '  ' });
    expect(doc.mock.calls.at(-1)?.slice(1)).toEqual(['households', 'hh1', 'savingsGoals', 'g1']);
    expect(setDoc.mock.calls[0][1]).toMatchObject({ name: 'Trip', allocatedUsd: 0, notes: null, targetUsd: 500 });
  });

  it('writes investments under the signed-in user, not the household', async () => {
    await saveInvestment('u1', {
      id: 'a1',
      name: '  TFSA  ',
      kind: 'stocks',
      contributedUsd: 100,
      valueUsd: 110,
      notes: '',
      createdAt: 'c',
      updatedAt: 'u',
    });
    expect(doc.mock.calls.at(-1)?.slice(1)).toEqual(['users', 'u1', 'investmentAccounts', 'a1']);
    expect(setDoc.mock.calls[0][1]).toMatchObject({ name: 'TFSA', notes: null, kind: 'stocks' });
  });

  it('deletes snapshot docs before the account so history cannot orphan', async () => {
    const order: string[] = [];
    deleteDoc.mockImplementation(async (ref: { path: string }) => {
      order.push(ref.path);
    });
    await deleteInvestment('u1', 'a1', ['s2', 's1']);
    expect(order).toEqual(['users/u1/investmentSnapshots/s2', 'users/u1/investmentSnapshots/s1', 'users/u1/investmentAccounts/a1']);
  });

  it('stops a recurring schedule without deleting past rows', async () => {
    await stopRecurring('hh1', 'incomes', 'i9');
    expect(updateDoc).toHaveBeenCalledWith({ path: 'households/hh1/incomes/i9' }, { recurring: null, updatedAt: expect.any(String) });
  });

  it('toggles budget alerts on the household doc', async () => {
    await setBudgetAlertsEnabled('hh1', false);
    expect(setDoc).toHaveBeenCalledWith(
      { path: 'households/hh1' },
      { budgets: { alertsEnabled: false }, updatedAt: 'SERVER_TS' },
      { merge: true },
    );
  });
});
