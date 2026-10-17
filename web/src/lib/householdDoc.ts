/** Parse the household Firestore doc the way DataProvider applies it. */

export function parseHouseholdSnapshot(d: Record<string, unknown> | undefined): {
  budgets: Record<string, number>;
  budgetAlerts: boolean;
  customCategories: Array<{ name: string; color?: string }>;
  memberUids: string[];
} {
  const data = d ?? {};
  const budgets = data.budgets as { byCategory?: Record<string, number>; alertsEnabled?: boolean } | undefined;
  return {
    budgets: budgets?.byCategory ?? {},
    // Missing alertsEnabled means ON — the mobile app wrote that field only
    // after the toggle existed, so treating undefined as false would mute
    // alerts for every older household.
    budgetAlerts: budgets?.alertsEnabled !== false,
    customCategories: Array.isArray(data.customCategories)
      ? (data.customCategories as Array<{ name: string; color?: string }>)
      : [],
    memberUids: Array.isArray(data.memberUids) ? (data.memberUids as string[]) : [],
  };
}

/** Display name on the household panel: profile name, else email local-part. */
export function nameFromUserDoc(u: { displayName?: unknown; email?: unknown } | undefined | null): {
  name: string;
  email: string | null;
} {
  const email = typeof u?.email === 'string' ? u.email : null;
  const display = typeof u?.displayName === 'string' ? u.displayName : '';
  return { name: display || email?.split('@')[0] || 'Member', email };
}

/** Shell is ready once receipts, incomes and settlements have arrived.
 *  Goals and investments subscribe separately and must not block the dashboard. */
export function isHouseholdReady(
  householdId: string | null,
  loaded: { receipts: boolean; incomes: boolean; settlements: boolean },
): boolean {
  return Boolean(householdId) && loaded.receipts && loaded.incomes && loaded.settlements;
}
