export type BudgetStatus = 'onTrack' | 'watch' | 'over';

/** >90% spent = over, 70–90% = watch, otherwise on track (same thresholds
 *  as the Home budget chips). */
export function budgetStatus(spent: number, limit: number): BudgetStatus {
  const ratio = limit > 0 ? spent / limit : 0;
  if (ratio > 0.9) return 'over';
  if (ratio > 0.7) return 'watch';
  return 'onTrack';
}

export interface BudgetLine {
  category: string;
  spent: number;
  limit: number;
  /** limit − spent; negative once the budget is exceeded. */
  left: number;
  /** spent / limit, capped at 1 for the bar. */
  ratio: number;
  status: BudgetStatus;
}

export interface BudgetOverview {
  lines: BudgetLine[];
  /** Sum of the category budgets set in Settings (Recurring excluded). */
  totalBudget: number;
  /** Spent within the budgeted categories. */
  totalSpent: number;
  /** totalBudget − totalSpent; negative when over the whole budget. */
  leftOfTotal: number;
  /** Sum of what's still unspent in each category (overspent ones count 0),
   *  i.e. how much room remains across all budgets. */
  leftAcrossBudgets: number;
  /** True when a Recurring budget exists but is left out of the totals. */
  hasRecurringLine: boolean;
}

/** Builds the Budgets page model from budgets (USD) and month spend per
 *  budget key (see lib/budgetSpend.ts). Only categories with a budget > 0
 *  appear, biggest limit first. */
export function computeBudgetOverview(
  budgets: Record<string, number>,
  spendByKey: Record<string, number>,
  /** Budget key that overlays the categories (Recurring) and must not be
   *  added to the totals. */
  overlayKey?: string,
): BudgetOverview {
  const lines: BudgetLine[] = Object.entries(budgets)
    .filter(([, limit]) => limit > 0)
    .map(([category, limit]) => {
      const spent = spendByKey[category] ?? 0;
      return {
        category,
        spent,
        limit,
        left: limit - spent,
        ratio: Math.min(spent / limit, 1),
        status: budgetStatus(spent, limit),
      };
    })
    .sort((a, b) => b.limit - a.limit || a.category.localeCompare(b.category));

  // "Recurring" is an overlay axis, not a category: every recurring expense is
  // already counted in its own category, so adding its budget or spend to the
  // totals would count that money twice. Its row still shows; the totals don't.
  const counted = lines.filter((l) => l.category !== overlayKey);
  const totalBudget = counted.reduce((s, l) => s + l.limit, 0);
  const totalSpent = counted.reduce((s, l) => s + l.spent, 0);
  return {
    lines,
    totalBudget,
    totalSpent,
    leftOfTotal: totalBudget - totalSpent,
    leftAcrossBudgets: counted.reduce((s, l) => s + Math.max(0, l.left), 0),
    hasRecurringLine: counted.length !== lines.length,
  };
}
