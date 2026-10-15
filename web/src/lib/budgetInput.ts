/** Typed budget amount. Empty string is 0 so "Remove" can write a cleared budget. */
export function parseBudgetAmount(text: string): number | null {
  const n = Number(text);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** Categories that can still be added — a 0 budget is treated as removed. */
export function unbudgetedCategories(names: string[], budgets: Record<string, number>): string[] {
  return names.filter((c) => !(budgets[c] > 0));
}
