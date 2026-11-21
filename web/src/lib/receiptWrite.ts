import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';
import { calendarDateKey } from '@app/lib/calendarDate';

export const round2 = (n: number) => Math.round(n * 100) / 100;

/** Store noon local so a civil YYYY-MM-DD does not shift when serialized as UTC ISO. */
export function receiptStoredDate(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d, 12).toISOString();
}

export function receiptCivilDay(ymd: string): string | null {
  return calendarDateKey(receiptStoredDate(ymd));
}

export function validateReceiptForm(input: {
  store: string;
  total: number;
  tags: string[];
  items: { name: string; amount: number }[];
  splitOn: boolean;
  people: string[];
  method: 'equal' | 'percent' | 'amount' | 'shares';
  values: Record<string, number>;
}): string | null {
  if (!input.store.trim()) return 'Enter the store name.';
  if (!(input.total > 0)) return 'Enter a total greater than zero.';
  if (input.tags.length === 0) return 'Pick at least one category.';
  if (input.items.some((i) => !i.name.trim() || !(i.amount !== 0 && Number.isFinite(i.amount)))) {
    return 'Each item needs a name and an amount.';
  }
  if (!input.splitOn) return null;
  if (input.people.length < 2) return 'Choose at least two people to split with.';
  const nums = input.people.map((p) => input.values[p] || 0);
  const sum = nums.reduce((a, b) => a + b, 0);
  if (input.method === 'percent' && Math.abs(sum - 100) > 0.01) return 'Percentages must add up to 100.';
  if (input.method === 'amount' && Math.abs(sum - input.total) > 0.01) return 'Amounts must add up to the total.';
  if (input.method === 'shares' && nums.every((x) => x <= 0)) return 'Give at least one person a share.';
  return null;
}

export function storedTaxUsd(tax: string, currency: CurrencyCode): number | null {
  return tax && Number(tax) > 0 ? round2(convertEntryToUsd(Number(tax), currency)) : null;
}

export function storedSplitValues(
  method: 'equal' | 'percent' | 'amount' | 'shares',
  people: string[],
  values: Record<string, number>,
  currency: CurrencyCode,
): Receipt['split'] {
  if (method === 'equal') return { enabled: true, method, participantIds: people };
  const v: Record<string, number> = {};
  for (const p of people) v[p] = values[p] || 0;
  const stored = method === 'amount' ? Object.fromEntries(Object.entries(v).map(([k, n]) => [k, round2(convertEntryToUsd(n, currency))])) : v;
  return { enabled: true, method, participantIds: people, values: stored };
}
