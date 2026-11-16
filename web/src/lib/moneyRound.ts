/** Cents-rounded USD. Budgets cannot go negative; settlements keep sign. */
export const roundUsd = (amountUsd: number): number => Math.round(amountUsd * 100) / 100;
export const roundBudgetUsd = (amountUsd: number): number => Math.max(0, roundUsd(amountUsd));
