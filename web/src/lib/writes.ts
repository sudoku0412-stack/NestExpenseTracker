import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { IncomeCategory } from '@app/types';
import { db } from '../firebase';

// These write the same document shapes the mobile app's cloudSync.ts writes
// (serializeReceipt / syncIncomeToCloud), and always bump updatedAt: the app
// ignores a cloud row that is not newer than its local copy.

const noonIso = (ymd: string): string => {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
};

export async function addReceipt(args: {
  householdId: string;
  uid: string;
  storeName: string;
  date: string; // YYYY-MM-DD
  amount: number; // in `currency`
  currency: CurrencyCode;
  category: string;
  notes?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'households', args.householdId, 'receipts', id), {
    id,
    storeName: args.storeName.trim(),
    date: noonIso(args.date),
    totalAmount: convertEntryToUsd(args.amount, args.currency),
    subtotalAmount: null,
    taxAmount: null,
    category: args.category,
    categoryTags: [args.category],
    rawText: null,
    imageUri: null,
    photoUrl: null,
    notes: args.notes?.trim() || null,
    split: null,
    recurring: null,
    paidBy: args.uid,
    createdBy: args.uid,
    isRecurringOccurrence: false,
    originalCurrency: args.currency,
    lineItems: [],
    createdAt: now,
    updatedAt: now,
  });
}

export const deleteReceipt = (householdId: string, id: string) =>
  deleteDoc(doc(db, 'households', householdId, 'receipts', id));

export async function addIncome(args: {
  householdId: string;
  uid: string;
  sourceName: string;
  date: string; // YYYY-MM-DD
  amount: number;
  currency: CurrencyCode;
  category: IncomeCategory;
  earnedBy: string;
  notes?: string;
}): Promise<void> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await setDoc(doc(db, 'households', args.householdId, 'incomes', id), {
    sourceName: args.sourceName.trim(),
    date: args.date,
    amountUsd: convertEntryToUsd(args.amount, args.currency),
    category: args.category,
    earnedBy: args.earnedBy,
    notes: args.notes?.trim() || null,
    originalCurrency: args.currency,
    recurring: null,
    isRecurringOccurrence: false,
    createdBy: args.uid,
    createdAt: now,
    updatedAt: now,
  });
}

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
