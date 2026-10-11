/** Shared write-side sanitizers. Firestore stores money in USD cents-rounded
 *  the same way the mobile app does; budgets cannot go negative; optional
 *  notes are trimmed to null so empty strings do not survive as notes. */

export const roundUsd = (n: number) => Math.round(n * 100) / 100;

export const clampBudgetUsd = (n: number) => Math.max(0, roundUsd(n));

export const trimOrNull = (s?: string | null) => s?.trim() || null;
