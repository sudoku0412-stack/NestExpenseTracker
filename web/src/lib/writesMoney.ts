export const roundUsd = (n: number): number => Math.round(n * 100) / 100;
export const clampBudgetUsd = (amountUsd: number): number => Math.max(0, roundUsd(amountUsd));
