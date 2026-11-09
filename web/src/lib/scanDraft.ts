import { convertEntryToUsd, type CurrencyCode } from '@app/lib/currency';
import type { Receipt } from '@app/types';

const CATEGORIES = new Set([
  'Groceries',
  'Electronics',
  'Dining',
  'Pharmacy',
  'Gas',
  'Clothing',
  'Entertainment',
  'Travel',
  'Healthcare',
  'Electricity',
  'Other',
]);

const numOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Turns the web-api vision JSON into a receipt draft. Drops unknown
 *  categories, non-numeric amounts, and dates that are not YYYY-MM-DD. */
export function draftFromAiReceipt(
  r: Record<string, unknown>,
  currency: CurrencyCode,
  newId: () => string,
): Partial<Receipt> {
  const category = typeof r.category === 'string' && CATEGORIES.has(r.category) ? r.category : 'Other';
  const usd = (n: unknown) => {
    const v = numOrNull(n);
    return v === null ? undefined : convertEntryToUsd(v, currency);
  };
  const items = Array.isArray(r.lineItems) ? (r.lineItems as { name?: unknown; amount?: unknown }[]) : [];
  return {
    storeName: typeof r.storeName === 'string' ? r.storeName : '',
    date: typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(r.date) ? r.date.slice(0, 10) : undefined,
    totalAmount: usd(r.totalAmount) ?? 0,
    taxAmount: usd(r.taxAmount),
    category,
    categoryTags: [category],
    originalCurrency: currency,
    lineItems: items
      .filter((i) => typeof i.name === 'string' && numOrNull(i.amount) !== null)
      .map((i) => ({
        id: newId(),
        name: i.name as string,
        amount: convertEntryToUsd(i.amount as number, currency),
        category,
      })),
  };
}
