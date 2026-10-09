import { calendarDateKey, isInCalendarMonth } from '@app/lib/calendarDate';
import type { Income, Receipt } from '@app/types';

export const RECURRING_BUDGET_KEY = 'Recurring';

export const inMonth = <T extends { date: string }>(rows: T[], year: number, month: number): T[] =>
  rows.filter((r) => isInCalendarMonth(r.date, year, month));

export const isRecurringExpense = (r: Receipt): boolean =>
  Boolean(r.recurring) || Boolean(r.isRecurringOccurrence);

/** Spend per budget key; mirrors lib/budgetSpend.ts in the mobile app (that
 *  file pulls in SQLite through lib/recurring, so the web keeps its own copy). */
export function computeBudgetSpend(receipts: Receipt[]): Record<string, number> {
  const spend: Record<string, number> = {};
  const add = (key: string, amount: number) => {
    spend[key] = (spend[key] ?? 0) + amount;
  };
  for (const r of receipts) {
    const items = r.lineItems ?? [];
    const itemSum = items.reduce((s, it) => s + it.amount, 0);
    if (items.length > 0 && itemSum > 0.005) {
      for (const it of items) add((it.category as string | undefined) || r.category, (r.totalAmount * it.amount) / itemSum);
    } else {
      add(r.category, r.totalAmount);
    }
    if (isRecurringExpense(r) && r.category !== RECURRING_BUDGET_KEY) add(RECURRING_BUDGET_KEY, r.totalAmount);
  }
  return spend;
}

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Per-day spend and running total for the month (month is 1-12). */
export function dailySeries(receipts: Receipt[], year: number, month: number) {
  const n = daysInMonth(year, month);
  const perDay = new Array<number>(n).fill(0);
  for (const r of receipts) {
    const key = calendarDateKey(r.date);
    if (!key) continue;
    const d = Number(key.slice(8, 10));
    if (d >= 1 && d <= n) perDay[d - 1] += r.totalAmount;
  }
  let run = 0;
  return perDay.map((spent, i) => {
    run += spent;
    return { day: i + 1, spent, total: run };
  });
}

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (year: number, month: number): string =>
  new Date(year, month - 1, 1).toLocaleString('en-US', { month: 'long', year: 'numeric' });

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const d = new Date(year, month - 1 + delta, 1);
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}

/** Earned vs spent for the `count` months ending at (year, month). */
export function trend(receipts: Receipt[], incomes: Income[], year: number, month: number, count = 6) {
  const out = [];
  for (let i = count - 1; i >= 0; i--) {
    const m = shiftMonth(year, month, -i);
    const spent = inMonth(receipts, m.year, m.month).reduce((s, r) => s + r.totalAmount, 0);
    const earned = inMonth(incomes, m.year, m.month).reduce((s, r) => s + r.amountUsd, 0);
    out.push({ label: MONTHS[m.month - 1], spent, earned, net: earned - spent });
  }
  return out;
}

export function topStores(receipts: Receipt[], limit = 6) {
  const map = new Map<string, { store: string; total: number; count: number }>();
  for (const r of receipts) {
    const key = r.storeName.trim().toLowerCase();
    const cur = map.get(key) ?? { store: r.storeName.trim() || 'Unknown', total: 0, count: 0 };
    cur.total += r.totalAmount;
    cur.count += 1;
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.total - a.total).slice(0, limit);
}

/** Recurring templates (the rows that still carry a schedule), soonest first. */
export function upcomingRecurring(receipts: Receipt[], today = new Date()) {
  const todayKey = today.toISOString().slice(0, 10);
  return receipts
    .filter((r) => r.recurring && r.recurring.endDate >= todayKey)
    .map((r) => ({ receipt: r, due: r.recurring!.nextDueDate, frequency: r.recurring!.frequency }))
    .sort((a, b) => a.due.localeCompare(b.due));
}

export const dateLabel = (dateStr: string): string => {
  const key = calendarDateKey(dateStr);
  if (!key) return dateStr;
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
};
