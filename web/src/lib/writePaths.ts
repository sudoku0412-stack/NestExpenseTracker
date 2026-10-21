/**
 * Firestore path segments for web writes. Household collections are
 * shared; investment holdings are personal under users/{uid} and must
 * never be written onto a household (owner-only rules, and leaving a
 * household must not orphan or expose them).
 */

export type HouseholdCollection = 'receipts' | 'incomes' | 'settlements' | 'savingsGoals';

export const householdRoot = (householdId: string) =>
  ['households', householdId] as const;

export const householdDoc = (
  householdId: string,
  collection: HouseholdCollection,
  id: string,
) => ['households', householdId, collection, id] as const;

export const userInvestmentAccount = (uid: string, id: string) =>
  ['users', uid, 'investmentAccounts', id] as const;

export const userInvestmentSnapshot = (uid: string, id: string) =>
  ['users', uid, 'investmentSnapshots', id] as const;

/** Stopping a schedule must set `recurring: null`. Omitting the field
 *  on updateDoc would leave the template repeating. */
export const stopRecurringPatch = (updatedAt: string) => ({
  recurring: null as null,
  updatedAt,
});
