import type { Income, Receipt } from '@app/types';
import { inMonth } from './stats';

export type ReceiptScope = 'month' | 'all';

/** Receipts page: month vs all-time, primary category, store/notes search, newest first. */
export function filterReceiptRows(
  receipts: Receipt[],
  opts: { scope: ReceiptScope; year: number; month: number; query: string; category: string },
): Receipt[] {
  const base = opts.scope === 'month' ? inMonth(receipts, opts.year, opts.month) : receipts;
  const needle = opts.query.trim().toLowerCase();
  return base
    .filter(
      (r) =>
        (opts.category === 'all' || r.category === opts.category) &&
        (!needle || r.storeName.toLowerCase().includes(needle) || (r.notes ?? '').toLowerCase().includes(needle)),
    )
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Income page: civil-month rows for one earner (or everyone), newest first. */
export function filterIncomeRows(
  incomes: Income[],
  opts: { year: number; month: number; earnedBy: string },
): Income[] {
  return inMonth(incomes, opts.year, opts.month)
    .filter((i) => opts.earnedBy === 'all' || i.earnedBy === opts.earnedBy)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Recurring page: templates only, soonest nextDueDate first. */
export function sortRecurringTemplates<T extends { recurring?: { nextDueDate: string } | null }>(rows: T[]): T[] {
  return rows
    .filter((r) => r.recurring)
    .sort((a, b) => a.recurring!.nextDueDate.localeCompare(b.recurring!.nextDueDate));
}
