import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';
import { buildSchedule, type Frequency } from './schedule';

export type SplitMethod = 'equal' | 'percent' | 'amount' | 'shares';

export interface DraftItem {
  key: string;
  name: string;
  amount: string;
  category: string;
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Warn when the form has items and items + tax disagree with the typed total. */
export function itemsPlusTaxMismatch(itemCount: number, itemsSum: number, tax: string, total: string): boolean {
  return itemCount > 0 && Number(total) > 0 && Math.abs(itemsSum + (Number(tax) || 0) - Number(total)) > 0.02;
}

export function validateReceiptDraft(input: {
  store: string;
  total: string;
  tags: string[];
  items: DraftItem[];
  splitOn: boolean;
  method: SplitMethod;
  people: string[];
  vals: Record<string, string>;
}): string | null {
  const totalN = Number(input.total);
  if (!input.store.trim()) return 'Enter the store name.';
  if (!(totalN > 0)) return 'Enter a total greater than zero.';
  if (input.tags.length === 0) return 'Pick at least one category.';
  if (input.items.some((i) => !i.name.trim() || !(Number(i.amount) !== 0 && Number.isFinite(Number(i.amount))))) {
    return 'Each item needs a name and an amount.';
  }
  if (!input.splitOn) return null;
  if (input.people.length < 2) return 'Choose at least two people to split with.';
  const v: Record<string, number> = {};
  if (input.method !== 'equal') for (const p of input.people) v[p] = Number(input.vals[p]) || 0;
  if (input.method === 'percent' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - 100) > 0.01) {
    return 'Percentages must add up to 100.';
  }
  if (input.method === 'amount' && Math.abs(Object.values(v).reduce((a, b) => a + b, 0) - totalN) > 0.01) {
    return 'Amounts must add up to the total.';
  }
  if (input.method === 'shares' && Object.values(v).every((x) => x <= 0)) {
    return 'Give at least one person a share.';
  }
  return null;
}

export function buildReceiptSplit(
  splitOn: boolean,
  method: SplitMethod,
  people: string[],
  vals: Record<string, string>,
  currency: CurrencyCode,
): Receipt['split'] | null {
  if (!splitOn) return null;
  const v: Record<string, number> = {};
  if (method !== 'equal') for (const p of people) v[p] = Number(vals[p]) || 0;
  // Amounts are typed in the entry currency; stored values are USD like the rest of the receipt.
  const stored = method === 'amount' ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(convertEntryToUsd(n, currency))])) : v;
  return { enabled: true, method, participantIds: people, ...(method === 'equal' ? {} : { values: stored }) };
}

/** Civil YYYY-MM-DD at local noon, same as the receipt editor (avoids UTC-date rollbacks). */
export function receiptDateIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

export function buildReceiptWrite(input: {
  id: string;
  store: string;
  date: string;
  total: string;
  tax: string;
  tags: string[];
  notes: string;
  items: DraftItem[];
  split: Receipt['split'] | null;
  repeat: { enabled: boolean; frequency: Frequency; months: string };
  existingEndDate?: string;
  paidBy: string;
  fallbackUid: string;
  currency: CurrencyCode;
  now: string;
  isNew: boolean;
}): Record<string, unknown> {
  const totalN = Number(input.total);
  return {
    id: input.id,
    storeName: input.store.trim(),
    date: receiptDateIso(input.date),
    totalAmount: round2(convertEntryToUsd(totalN, input.currency)),
    taxAmount: input.tax && Number(input.tax) > 0 ? round2(convertEntryToUsd(Number(input.tax), input.currency)) : null,
    category: input.tags[0],
    categoryTags: input.tags,
    notes: input.notes.trim() || null,
    split: input.split,
    recurring: buildSchedule(input.repeat.enabled, input.repeat.frequency, input.date, parseInt(input.repeat.months, 10) || 0, input.existingEndDate),
    paidBy: input.paidBy || input.fallbackUid,
    originalCurrency: input.currency,
    lineItems: input.items.map((i) => ({
      id: i.key,
      name: i.name.trim(),
      amount: round2(convertEntryToUsd(Number(i.amount), input.currency)),
      category: i.category,
      splitWith: [],
    })),
    ...(input.isNew
      ? {
          createdBy: input.fallbackUid,
          isRecurringOccurrence: false,
          rawText: null,
          imageUri: null,
          photoUrl: null,
          subtotalAmount: null,
          createdAt: input.now,
        }
      : {}),
    updatedAt: input.now,
  };
}
