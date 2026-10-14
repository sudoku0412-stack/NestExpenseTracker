import { daysInMonth } from './stats';

export function monthSpendProjection(
  totalSpent: number,
  year: number,
  month: number,
  now: Date,
): { isCurrent: boolean; elapsed: number; dayAvg: number; projected: number } {
  const isCurrent = now.getFullYear() === year && now.getMonth() + 1 === month;
  const elapsed = isCurrent ? now.getDate() : daysInMonth(year, month);
  const dayAvg = elapsed > 0 ? totalSpent / elapsed : 0;
  return {
    isCurrent,
    elapsed,
    dayAvg,
    projected: isCurrent ? dayAvg * daysInMonth(year, month) : totalSpent,
  };
}

/** Percent change vs last month. Null when last month had no spending (UI: "No spending last month"). */
export function vsPreviousPct(current: number, previous: number): number | null {
  return previous > 0 ? ((current - previous) / previous) * 100 : null;
}
