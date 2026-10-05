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
  /** Sum of every budget set in Settings, Recurring included. */
  totalBudget: number;
  /** Spent within the budgeted categories. */
  totalSpent: number;
  /** totalBudget − totalSpent; negative when over the whole budget. */
  leftOfTotal: number;
  /** Sum of what's still unspent in each category (overspent ones count 0),
   *  i.e. how much room remains across all budgets. */
  leftAcrossBudgets: number;
}

/** Builds the Budgets page model from budgets (USD) and month spend per
 *  budget key (see lib/budgetSpend.ts). Only categories with a budget > 0
 *  appear, biggest limit first. */
export function computeBudgetOverview(
  budgets: Record<string, number>,
  spendByKey: Record<string, number>,
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

  const totalBudget = lines.reduce((s, l) => s + l.limit, 0);
  const totalSpent = lines.reduce((s, l) => s + l.spent, 0);
  return {
    lines,
    totalBudget,
    totalSpent,
    leftOfTotal: totalBudget - totalSpent,
    leftAcrossBudgets: lines.reduce((s, l) => s + Math.max(0, l.left), 0),
  };
}
