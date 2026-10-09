import { deleteDoc, doc, setDoc } from 'firebase/firestore';
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
