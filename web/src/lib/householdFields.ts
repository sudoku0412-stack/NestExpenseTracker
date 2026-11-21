/** Missing alertsEnabled means ON (same as the phone's household doc). */
export function budgetAlertsEnabled(alertsEnabled: unknown): boolean {
  return alertsEnabled !== false;
}

export function memberDisplayName(u?: { displayName?: unknown; email?: unknown } | null): { name: string; email: string | null } {
  const email = (typeof u?.email === 'string' ? u.email : null) as string | null;
  const display = typeof u?.displayName === 'string' ? u.displayName : '';
  return { name: display || email?.split('@')[0] || 'Member', email };
}

export function nextAllocatedUsd(current: number, signedDeltaUsd: number): number {
  return Math.max(0, current + signedDeltaUsd);
}

export function goalRatio(allocatedUsd: number, targetUsd: number): number {
  return targetUsd > 0 ? Math.min(allocatedUsd / targetUsd, 1) : 0;
}
