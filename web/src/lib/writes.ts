import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

// Small Firestore writes. Receipt and income forms live in src/forms. Every write
// that changes a receipt bumps updatedAt: the mobile app ignores a cloud row that
// is not newer than its local copy.

export const deleteReceipt = (householdId: string, id: string) =>
  deleteDoc(doc(db, 'households', householdId, 'receipts', id));

export const deleteIncome = (householdId: string, id: string) =>
  deleteDoc(doc(db, 'households', householdId, 'incomes', id));

// Budgets live on the household doc as budgets.byCategory (USD) and
// budgets.alertsEnabled, the same place the mobile app mirrors them. The
// nested merge updates one category without touching the others. The app
// cannot delete a synced category, so removing a budget writes 0.
export const setCategoryBudget = (householdId: string, category: string, amountUsd: number) =>
  setDoc(
    doc(db, 'households', householdId),
    { budgets: { byCategory: { [category]: Math.max(0, Math.round(amountUsd * 100) / 100) } }, updatedAt: serverTimestamp() },
    { merge: true },
  );

export const setBudgetAlertsEnabled = (householdId: string, enabled: boolean) =>
  setDoc(doc(db, 'households', householdId), { budgets: { alertsEnabled: enabled }, updatedAt: serverTimestamp() }, { merge: true });

/** Settle up: a ledger entry only, never a receipt. `fromUid` pays `toUid`. */
export async function addSettlement(householdId: string, fromUid: string, toUid: string, amountUsd: number): Promise<void> {
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'households', householdId, 'settlements', id), {
    fromUid,
    toUid,
    amountUsd: Math.round(amountUsd * 100) / 100,
    createdAt: new Date().toISOString(),
  });
}

export interface GoalInput { name: string; targetUsd: number; allocatedUsd: number; notes?: string }

export async function saveGoal(householdId: string, goal: GoalInput & { id?: string; createdAt?: string }): Promise<void> {
  const now = new Date().toISOString();
  const id = goal.id ?? crypto.randomUUID();
  await setDoc(doc(db, 'households', householdId, 'savingsGoals', id), {
    name: goal.name.trim(),
    targetUsd: goal.targetUsd,
    allocatedUsd: Math.max(0, goal.allocatedUsd),
    notes: goal.notes?.trim() || null,
    createdAt: goal.createdAt ?? now,
    updatedAt: now,
  });
}

export const deleteGoal = (householdId: string, id: string) =>
  deleteDoc(doc(db, 'households', householdId, 'savingsGoals', id));

/** Stop a recurring schedule; the rows it already created stay. */
export const stopRecurring = (householdId: string, collection: 'receipts' | 'incomes', id: string) =>
  updateDoc(doc(db, 'households', householdId, collection, id), { recurring: null, updatedAt: new Date().toISOString() });
